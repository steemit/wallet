// Vault manager (A4) — the orchestration layer implementing the A0
// `VaultManager` interface over the landed primitives:
//
//   - persistence via the A2 registry (atomic alias uniqueness, CAS, settings);
//   - the unlock session via the A2 service (one manager = one service
//     instance = one tab's session — sessions are pure memory);
//   - backup/import/merge via the A3 backup layer.
//
// BLUEPRINT HARD CONTRACTS implemented here (kickoff A4 rules, 2026-11-04
// ruling; see docs/AI-driver/09-vault.md "Post-merge lock is the Manager
// layer's job"):
//   1. A successful MERGE migration locks the target: `importVault` calls
//      `service.lock()` right after `mergeVaultBackup` succeeds (the low-level
//      primitive deliberately does not lock), so the orchestration leaves
//      `locked: true` with the target record's `lockEpoch` +1 versus
//      pre-merge. A `lock()` persistence failure still has cleared memory and
//      still propagates — no "merged but still unlocked" path exists.
//   2. The merge's `preMergeBackup` snapshot is handed back to the caller
//      (`importVaultDetailed`): it is a MEMORY-ONLY snapshot that is neither
//      persisted nor reflected in `lastBackupAt`. Callers (A5 UI) must
//      deliver it to the user (file save/download or an explicit discard)
//      and must NOT claim the pre-migration backup is complete before that.
//
// SENSITIVE-DATA RULES: the manager holds the service instance; KEK and
// payload stay inside that closure. `changePassword` composes
// `readUnlockedPayload` (vault-internal, invariant-14 boundary) to re-encrypt
// the payload under a fresh salt — `mutatePayload` cannot be used for a
// password change because it only rotates the IV and deliberately keeps the
// salt (new salts belong to password changes). Error messages never echo
// names, passwords, salts, IVs, ciphertext or key material.
import { encodeBase64Url } from './envelope';
import { deriveVaultKek, encryptVaultText, generateVaultIv, generateVaultSalt } from './crypto';
import { VaultError } from './errors';
import {
  exportVaultBackup,
  importVaultBackup,
  mergeVaultBackup,
} from './backup';
import { type VaultRegistry } from './registry';
import { createVaultService, type VaultService, type VaultServiceStatus } from './service';
import { createVaultSigner, readUnlockedPayload } from './signer';
import type {
  ImportVaultParams,
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  VaultAccountSummary,
  VaultEnvelopeV1,
  VaultManager,
  VaultRecordV1,
  VaultSummary,
} from './types';
import { validateVaultPassword, vaultNameComparisonKey } from './validation';

/** The full import result: the A0 summary plus the merge safety net. */
export interface ImportVaultDetailedResult {
  summary: VaultSummary;
  /**
   * The pre-merge five-field envelope of the merge TARGET (memory-only
   * snapshot; not persisted, does not touch `lastBackupAt`). `null` for
   * independent imports (nothing was merged over). The caller MUST deliver
   * this to the user — saving/downloading the file or an explicit discard —
   * before claiming the pre-migration backup is done.
   */
  preMergeBackup: VaultEnvelopeV1 | null;
}

function notFound(): VaultError {
  return new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
}

/**
 * The manager's extended surface: the A0 `VaultManager` interface VERBATIM
 * plus the orchestration extras A4/A5 need (the A0 interface alone has no way
 * to unlock, which merge/changePassword/getAccounts all require).
 */
export interface VaultManagerExtended extends VaultManager {
  /**
   * Unlock a vault in this manager's session service (delegates to
   * `VaultService.unlock`: existing-password authentication, no strength
   * policy; switching vaults clears the previous session completely).
   * Exposed because merge migrations, password changes and account reads all
   * operate on the unlocked session — without it the A0 method set could
   * never succeed outside tests.
   */
  unlockVault(vaultName: string, password: string): Promise<VaultServiceStatus>;
  /**
   * Import with the merge safety net attached — `importVault` is exactly this
   * minus the `preMergeBackup` handoff. See {@link ImportVaultDetailedResult}.
   */
  importVaultDetailed(params: ImportVaultParams): Promise<ImportVaultDetailedResult>;
  /**
   * Build the vault-mode signer SHARING this manager's session service. The
   * vault signer is only useful wired to the service the UI unlocks — one
   * tab must never build signers over private service instances.
   */
  createSigner(): {
    signOperations(request: SignOperationsRequest): Promise<SignResult>;
    signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult>;
  };
  /** Tear down the session service (clears any session, closes the channel). */
  destroy(): void;
}

/**
 * Session status that treats STALE as "locked": a stale session has already
 * been cleared by the service's own hard line when the error surfaced, so
 * every vault is locked from this tab's perspective. Used by flows that must
 * not fail merely because the session died concurrently (locking another
 * vault, listing).
 */
async function tolerantStatus(service: VaultService): Promise<VaultServiceStatus> {
  try {
    return await service.getStatus();
  } catch (error) {
    if (error instanceof VaultError && error.code === 'VAULT_SESSION_STALE') {
      return { locked: true, vaultName: null, revision: null, lockEpoch: null };
    }
    throw error;
  }
}

/** Whether a session status (unlocked) points at the given vault name. */
function statusMatchesVault(status: VaultServiceStatus, vaultName: string): boolean {
  return (
    !status.locked &&
    status.vaultName !== null &&
    vaultNameComparisonKey(status.vaultName) === vaultNameComparisonKey(vaultName)
  );
}

/**
 * Build the A4 vault manager over a registry. The manager owns exactly one
 * unlock-session service (created here, destroyed by {@link
 * VaultManagerExtended.destroy}) — pass the SAME registry to the signing
 * facade and any other vault consumer so they share one record view.
 */
export function createVaultManager(registry: VaultRegistry): VaultManagerExtended {
  const service = createVaultService(registry);

  /** Summarize one record: `active` from settings, `locked` from the session. */
  async function summarize(record: VaultRecordV1, status: VaultServiceStatus): Promise<VaultSummary> {
    const settings = await registry.getSettings();
    const active =
      settings.activeVaultName !== null &&
      vaultNameComparisonKey(settings.activeVaultName) === vaultNameComparisonKey(record.vaultName);
    return {
      vaultName: record.vaultName,
      active,
      locked: !statusMatchesVault(status, record.vaultName),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastBackupAt: record.lastBackupAt,
    };
  }

  /** Read a record or fail with the manager's uniform NOT_FOUND. */
  async function requireRecord(vaultName: string): Promise<VaultRecordV1> {
    const record = await registry.getRecord(vaultName);
    if (record === null) {
      throw notFound();
    }
    return record;
  }

  async function importVaultDetailed(params: ImportVaultParams): Promise<ImportVaultDetailedResult> {
    if (params.mode === 'independent') {
      // No activation, no session impact (the import's internal service is
      // scoped inside the A3 primitive); no pre-merge snapshot exists.
      const record = await importVaultBackup(registry, params);
      const status = await tolerantStatus(service);
      return { summary: await summarize(record, status), preMergeBackup: null };
    }
    // MERGE: the target must already be unlocked in THIS manager's service
    // (unlockVault first — the A5 flow's job). The primitive snapshots the
    // pre-merge envelope, merges with target-first dedupe under CAS, and
    // leaves the target unlocked — the post-merge LOCK is this layer's
    // blueprint contract.
    const merged = await mergeVaultBackup(registry, service, params);
    // lock() clears memory first, then persists lockEpoch +1 and broadcasts;
    // a persistence failure leaves memory cleared and propagates — there is
    // no successful merge path that stays unlocked.
    await service.lock();
    const record = await requireRecord(params.targetVaultName);
    return {
      summary: await summarize(record, {
        locked: true,
        vaultName: null,
        revision: null,
        lockEpoch: null,
      }),
      preMergeBackup: merged.preMergeBackup,
    };
  }

  return {
    async listVaults(): Promise<VaultSummary[]> {
      const records = await registry.listRecords();
      const status = await tolerantStatus(service);
      return Promise.all(records.map((record) => summarize(record, status)));
    },

    async createVault(params: { vaultName: string; password: string }): Promise<VaultSummary> {
      // Validation (alias rules + password policy) and atomic alias
      // uniqueness live inside the registry primitive. The new vault starts
      // with the empty payload and LOCKED — creation does not auto-unlock.
      const record = await registry.createVault(params);
      const status = await tolerantStatus(service);
      return summarize(record, status);
    },

    /**
     * A0-shaped import (summary only). For a MERGE migration prefer
     * {@link VaultManagerExtended.importVaultDetailed}: this method drops
     * the `preMergeBackup` snapshot, and a merge caller who ignores the
     * pre-migration backup handoff loses the merge's safety net.
     */
    async importVault(params: ImportVaultParams): Promise<VaultSummary> {
      const { summary } = await importVaultDetailed(params);
      return summary;
    },

    importVaultDetailed,

    async activateVault(vaultName: string): Promise<void> {
      const record = await requireRecord(vaultName);
      const settings = await registry.getSettings();
      await registry.putSettings({ ...settings, activeVaultName: record.vaultName });
    },

    async renameVault(oldName: string, newName: string): Promise<void> {
      // Registry transaction: validated new name, alias uniqueness, settings
      // pointer follow. An unlocked session on the OLD name is invalidated
      // implicitly — its next session-bound operation finds no record under
      // the old name and rejects with VAULT_SESSION_STALE (A2 semantics,
      // self-healing; the manager deliberately does not resurrect it under
      // the new name).
      await registry.renameVault(oldName, newName);
    },

    async removeVault(vaultName: string, password: string): Promise<void> {
      // Authenticate with the vault's EXISTING password via a THROWAWAY
      // service: deletion must not disturb an unrelated live session, and a
      // probe unlock is the registry-faithful password check (no lighter
      // verify primitive exists; re-deriving + decryptVaultText by hand would
      // re-implement unlock). One PBKDF2 is the price of a destructive op.
      // The strength policy never runs here — deletion keeps accepting the
      // password the vault was created with.
      const probe = createVaultService(registry);
      try {
        await probe.unlock(vaultName, password);
      } finally {
        probe.destroy();
      }
      // If the manager's own session belongs to the doomed vault, clear it
      // BEFORE the delete (lock() zeroes the KEK, bumps the epoch and
      // broadcasts — the subsequent delete makes the bump moot but harmless).
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) {
        await service.lock();
      }
      await registry.removeVault(vaultName);
    },

    async exportVault(vaultName: string): Promise<VaultEnvelopeV1> {
      // exportVaultBackup bumps revision via its lastBackupAt CAS, which
      // invalidates THIS tab's unlocked session for the vault too (A3 note).
      // Lock first when the session belongs to the exported vault — the
      // alternative is a zombie session that goes stale on its next use.
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) {
        await service.lock();
      }
      return exportVaultBackup(registry, vaultName);
    },

    async lockVault(vaultName?: string): Promise<void> {
      if (vaultName === undefined) {
        // Lock the current session (idempotent; no-op when already locked).
        await service.lock();
        return;
      }
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) {
        // Local lock: memory cleared, lockEpoch +1, acceleration broadcast.
        await service.lock();
        return;
      }
      // REMOTE-lock semantics for a vault this session does NOT hold: bump
      // its lockEpoch so every unlocked session for it (other tabs) fails its
      // next session-bound operation with VAULT_SESSION_STALE. Equivalent in
      // outcome to a local lock, minus the local memory (there is none).
      // Missing records surface VAULT_NOT_FOUND from the registry.
      await registry.bumpLockEpoch(vaultName);
    },

    /**
     * Re-encrypt the vault under a new password: fresh salt + fresh KEK via
     * registry CAS, then lock (the session holds the OLD KEK; the closing
     * lock's epoch bump also stales other tabs' sessions for this vault).
     *
     * Lock accounting when THIS manager already holds the same vault
     * unlocked: the net `lockEpoch` movement is +2 — the internal `unlock`
     * switches sessions first (clearing the previous one persists its own
     * +1), and the final `lock()` adds another +1. Both bumps are safe in
     * either direction: an epoch only ever moves forward, and every bump
     * just invalidates other tabs' sessions for this vault.
     *
     * A WRONG old password still runs the unlock's switch semantics first:
     * any session this service held (the same vault included) is locked and
     * NOT restored when authentication then fails — after a failed attempt
     * the caller must unlock again (the A5 UI should say so, not just
     * prompt for a retry).
     */
    async changePassword(
      vaultName: string,
      oldPassword: string,
      newPassword: string,
    ): Promise<void> {
      // Order (kickoff A4): old-password authentication FIRST (unlocking
      // keeps accepting the existing password — no policy), THEN the new
      // password's strength policy, THEN the re-encryption. mutatePayload is
      // unusable here by design: it rotates the IV but keeps the salt, and a
      // password change MUST mint a fresh salt + fresh KEK.
      await service.unlock(vaultName, oldPassword);
      validateVaultPassword(newPassword);
      // Read the decrypted payload through the just-established session
      // (vault-internal capture; see readUnlockedPayload's JSDoc — its
      // mutatePayload ride already runs the service's four-field hard line).
      const payload = await readUnlockedPayload(service);
      // The CAS pointer must describe the record the SESSION unlocked —
      // rewriting from a record that moved underneath would revert a
      // concurrent mutation with stale plaintext. `service.getStatus()` IS
      // that check, in its strongest form: it re-runs the service's
      // four-field hard line (createdAt + revision + lockEpoch against the
      // record) where the previous hand-rolled status compare could not see
      // `createdAt` and thus missed a same-name remove+recreate landing on
      // matching counters. Running it AFTER requireRecord pins the record
      // whose createdAt the swap pointer below uses; `swapRecord`'s own CAS
      // backstops the remaining read→write window.
      const record = await requireRecord(vaultName);
      // The guard only bites if the RETURN VALUE is checked: `getStatus`
      // answers a CLEARED session softly — `{ locked: true }` — instead of
      // throwing, because the hard line inside it never runs when there is
      // no session left to compare (service.ts getStatus early-returns). A
      // cross-tab lock/mutate acceleration event (BroadcastChannel) can
      // clear this tab's session between the payload capture and this
      // point; an unchecked call (review r2's C2) sails through exactly
      // then, and the swap below would re-encrypt the STALE captured
      // plaintext over the concurrent write — its CAS pointer comes from
      // the post-mutation record above, so the CAS cannot catch it. Same
      // shape as the signer's `assertSessionStillCurrent`: a session that
      // vanished mid-flight is STALE, never "fine".
      const fresh = await service.getStatus();
      if (fresh.locked || fresh.vaultName === null) {
        throw new VaultError(
          'VAULT_SESSION_STALE',
          'the unlocked vault changed outside this session; unlock again',
        );
      }
      const salt = generateVaultSalt();
      const iv = generateVaultIv();
      const kek = await deriveVaultKek(newPassword, salt);
      let ciphertext: string;
      try {
        ciphertext = encodeBase64Url(await encryptVaultText(kek, iv, JSON.stringify(payload)));
      } finally {
        // The new KEK lives only inside this scope — zeroize like every
        // other primitive does.
        kek.fill(0);
      }
      await registry.swapRecord(
        {
          vaultName: record.vaultName,
          createdAt: record.createdAt,
          revision: record.revision,
          lockEpoch: record.lockEpoch,
        },
        {
          ...record,
          salt: encodeBase64Url(salt),
          iv: encodeBase64Url(iv),
          ciphertext,
          revision: record.revision + 1,
          updatedAt: Date.now(),
        },
      );
      // Locking after a password change is the security default: the session
      // holds the OLD KEK (useless for future writes under the new salt, but
      // cleared now regardless), and the epoch bump stales any other tab's
      // unlocked session for this vault.
      await service.lock();
    },

    async getAccounts(): Promise<VaultAccountSummary[]> {
      // Session-bound (VAULT_LOCKED when nothing is unlocked; STALE when the
      // vault changed underneath). Balances stay null in A4 — loaded by
      // later stages.
      return service.getAccounts();
    },

    unlockVault(vaultName: string, password: string): Promise<VaultServiceStatus> {
      return service.unlock(vaultName, password);
    },

    createSigner() {
      return createVaultSigner(service);
    },

    destroy(): void {
      service.destroy();
    },
  };
}
