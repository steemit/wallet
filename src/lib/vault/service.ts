// Vault unlock-session service (A2) — the in-memory holder of one vault's
// KEK and fully decrypted payload ("whole-bucket" first version: after unlock
// every WIF lives here, on lock everything is cleared in full).
//
// SENSITIVE-DATA CONTRACT (the core of A2):
//   - The KEK bytes and the decrypted `VaultPayloadV1` exist ONLY inside this
//     factory's closure. No exported function returns them; `getAccounts()`
//     exposes only public-key-derived data (`VaultAccountSummary`), `getStatus()`
//     only non-sensitive counters. Nothing here ever goes to Redux, logs,
//     analytics or the network.
//   - On lock, the KEK (a `Uint8Array`) is zeroized best-effort with `fill(0)`
//     BEFORE its reference is dropped. The WIF strings inside the payload, the
//     password and the payload text are immutable JavaScript strings and CANNOT
//     be physically zeroed — dropping every reference is the best JavaScript
//     can do. This module never claims otherwise.
//
// CROSS-TAB INVALIDATION — two layers, deliberately:
//   1. HARD LINE (the defense): every session-bound operation (status query,
//      account read, payload mutation — and, from A4 on, every signing call)
//      re-reads the registry and compares `revision`/`lockEpoch` against the
//      session. Any drift (another tab locked, mutated, renamed or removed the
//      vault) clears the local session and rejects with `VAULT_SESSION_STALE`.
//      Potentially-delayed notifications are NEVER the only defense.
//   2. ACCELERATION (best effort): when `BroadcastChannel` exists, lock/mutate
//      events from other tabs clear this instance's session immediately. When
//      the API is missing the service degrades gracefully — the hard line
//      above is unaffected.
//
// ENVELOPE INVARIANTS: a plain unlock or lock never touches the stored salt,
// IV or ciphertext (AES-GCM is deterministic for a fixed key/IV/plaintext, so
// an unchanged payload needs no rewrite). Only `mutatePayload` re-encrypts:
// fresh IV (never reused for different plaintext), whole payload, same salt
// (a new salt belongs to password changes, not payload changes), revision +1
// via the registry's compare-and-swap.
import { decodeBase64Url, encodeBase64Url, validateVaultPayloadText } from './envelope';
import { decryptVaultText, deriveVaultKek, encryptVaultText, generateVaultIv } from './crypto';
import { VaultError } from './errors';
import { vaultRecordToEnvelope } from './registry';
import type { VaultRegistry } from './registry';
import type { VaultAccountSummary, VaultPayloadV1, VaultPublicKey, VaultRecordV1 } from './types';
import { validateVaultWif, vaultNameComparisonKey } from './validation';

/**
 * BroadcastChannel name shared by all vault service instances of this origin.
 * Intentionally the same string as the IndexedDB database name
 * (`VAULT_DB_NAME`); messages carry no sensitive material — only an event
 * kind and the target vault's comparison key.
 */
export const VAULT_BROADCAST_CHANNEL = 'steem-wallet-vault';

/** Non-sensitive session status — safe to pass anywhere in the UI. */
export interface VaultServiceStatus {
  locked: boolean;
  /** Session vault display name, or null when locked. */
  vaultName: string | null;
  revision: number | null;
  lockEpoch: number | null;
}

/** Message broadcast on lock/mutate for the acceleration layer. */
interface VaultBroadcastMessage {
  kind: 'vault-lock' | 'vault-mutate';
  key: string;
}

/** Internal session shape — SENSITIVE, closure-only. */
interface ActiveSession {
  vaultName: string;
  revision: number;
  lockEpoch: number;
  kek: Uint8Array<ArrayBuffer>;
  payload: VaultPayloadV1;
}

/** The fresh-session handle returned by the internal guard. */
interface FreshSession {
  session: ActiveSession;
  record: VaultRecordV1;
}

export interface VaultService {
  /**
   * Unlock a vault by name + its EXISTING password (the strength policy never
   * runs here — unlocking must keep accepting the password the vault was
   * created with). Flow: read record → fail-closed envelope validation →
   * PBKDF2 derivation → authenticated decrypt → payload validation → hold the
   * session in the closure. If ANY session is currently active (same or
   * another vault) it is locked COMPLETELY first — switching clears.
   *
   * Failures: `VAULT_NOT_FOUND`, `VAULT_ENVELOPE_INVALID` (corrupt stored
   * envelope), `VAULT_PASSWORD_INVALID` (empty password or GCM authentication
   * failure — wrong password and tampering are indistinguishable by design),
   * `VAULT_PAYLOAD_INVALID`/`VAULT_LIMIT_EXCEEDED` (decrypted payload fails
   * validation). A KEK derived during a failed unlock is zeroized before the
   * error propagates.
   */
  unlock(vaultName: string, password: string): Promise<VaultServiceStatus>;

  /**
   * Lock the active session (idempotent when already locked). Order matters:
   * memory first (KEK `fill(0)` + drop all references), then persistence
   * (`lockEpoch` +1 so other tabs' sessions for this vault go stale), then
   * broadcast the acceleration event. If the persistence step fails, this tab
   * is still locked — the error propagates to the caller.
   */
  lock(): Promise<void>;

  /**
   * Non-sensitive status. When unlocked this IS a session-bound operation:
   * the registry is re-read and `revision`/`lockEpoch` re-checked (hard line).
   * A stale session is cleared and rejects with `VAULT_SESSION_STALE`.
   */
  getStatus(): Promise<VaultServiceStatus>;

  /**
   * Public-derived account summaries of the unlocked vault. WIF → public key
   * goes through the shared `validateVaultWif` entry point (account
   * normalization + WIF check + derivation); failures reject with
   * `VAULT_KEY_INVALID`. Balances are null in A2 (loaded by later stages).
   * The result NEVER contains WIFs, the KEK or the payload.
   */
  getAccounts(): Promise<VaultAccountSummary[]>;

  /**
   * Mutate the unlocked vault's payload under one compare-and-swap:
   *
   *   1. hard-line freshness check (re-read + revision/lockEpoch compare),
   *   2. the mutator runs against a COPY of the session payload (throws
   *      propagate with nothing written and the session untouched),
   *   3. the serialized result is validated (`VAULT_PAYLOAD_INVALID` /
   *      `VAULT_LIMIT_EXCEEDED` — on failure NOTHING is written and the
   *      session keeps its original payload; that is the rollback semantics),
   *   4. whole-payload re-encryption with a FRESH IV and the session KEK
   *      (salt unchanged — new salts belong to password changes),
   *   5. CAS write: revision +1; a concurrent change rejects with
   *      `VAULT_SESSION_STALE` and clears the session.
   *
   * On success the session adopts the new payload and revision, and a
   * `vault-mutate` acceleration event is broadcast.
   */
  mutatePayload(mutator: (draft: VaultPayloadV1) => void): Promise<VaultServiceStatus>;

  /** Clear the session (if any) and close the BroadcastChannel. For teardown/tests. */
  destroy(): void;
}

function locked(): VaultError {
  return new VaultError('VAULT_LOCKED', 'no vault is unlocked in this session');
}

function sessionStale(): VaultError {
  return new VaultError(
    'VAULT_SESSION_STALE',
    'the unlocked vault changed outside this session; unlock again',
  );
}

function statusOf(session: ActiveSession): VaultServiceStatus {
  return {
    locked: false,
    vaultName: session.vaultName,
    revision: session.revision,
    lockEpoch: session.lockEpoch,
  };
}

function clonePayload(payload: VaultPayloadV1): VaultPayloadV1 {
  return JSON.parse(JSON.stringify(payload)) as VaultPayloadV1;
}

/**
 * Build the unlock-session service over a registry. A factory (not a class
 * singleton) so tests and future React lifecycle code can own independent
 * instances — one browser tab = one service instance; a fresh instance starts
 * locked (sessions are pure memory, so a page refresh locks).
 */
export function createVaultService(registry: VaultRegistry): VaultService {
  let session: ActiveSession | null = null;
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<VaultBroadcastMessage>) => {
      const data = event.data;
      if (session === null || data === null || typeof data !== 'object') return;
      if (data.kind !== 'vault-lock' && data.kind !== 'vault-mutate') return;
      if (vaultNameComparisonKey(session.vaultName) !== data.key) return;
      // Acceleration only — the hard line remains the actual defense. No
      // registry write and no broadcast here: the originating tab already
      // persisted the lockEpoch/revision change.
      clearSessionMemory();
    };
  }

  function clearSessionMemory(): void {
    if (session === null) return;
    // Best-effort zeroization. The KEK is a Uint8Array and CAN be zeroed.
    // The payload's WIF strings (and the unlock password, already out of
    // scope) are immutable JS strings and CANNOT be physically zeroed —
    // dropping the references is the honest limit.
    session.kek.fill(0);
    session = null;
  }

  /**
   * The hard line: re-read the registry and verify the session's
   * revision/lockEpoch still match the stored record. Missing record or drift
   * → clear memory, reject `VAULT_SESSION_STALE`. Also rejects `VAULT_LOCKED`
   * when no session exists (or one was cleared while awaiting, e.g. by an
   * acceleration event landing mid-operation).
   */
  async function requireFreshSession(): Promise<FreshSession> {
    if (session === null) {
      throw locked();
    }
    const snapshot = session;
    const record = await registry.getRecord(snapshot.vaultName);
    if (
      record === null ||
      record.revision !== snapshot.revision ||
      record.lockEpoch !== snapshot.lockEpoch
    ) {
      clearSessionMemory();
      throw sessionStale();
    }
    if (session !== snapshot) {
      // Cleared (or replaced — impossible from a single caller) while awaiting.
      throw locked();
    }
    return { session: snapshot, record };
  }

  async function lock(): Promise<void> {
    if (session === null) {
      return; // idempotent: locking a locked session is a no-op
    }
    const { vaultName } = session;
    clearSessionMemory();
    // Memory is already clear; persistence failures propagate but cannot
    // resurrect the session.
    await registry.bumpLockEpoch(vaultName);
    channel?.postMessage({
      kind: 'vault-lock',
      key: vaultNameComparisonKey(vaultName),
    });
  }

  return {
    async unlock(vaultName: string, password: string): Promise<VaultServiceStatus> {
      if (session !== null) {
        // Switching vaults clears the previous session COMPLETELY first: its
        // KEK/payload are dropped and ITS lockEpoch is persisted, invalidating
        // that vault's sessions in other tabs too. If the subsequent unlock of
        // the new target fails, the previous session is still gone — clearing
        // first is the contract, "unlock failure restores the old session" is
        // deliberately NOT offered.
        await lock();
      }
      const record = await registry.getRecord(vaultName);
      if (record === null) {
        throw new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
      }
      // Fail-closed five-field validation of the stored envelope before any
      // crypto runs (the registry already validated the row; this makes the
      // unlock flow's contract explicit and independent).
      const envelope = vaultRecordToEnvelope(record);
      const kek = await deriveVaultKek(password, decodeBase64Url(envelope.salt));
      let unlocked: ActiveSession;
      try {
        const payloadText = await decryptVaultText(
          kek,
          decodeBase64Url(envelope.iv),
          decodeBase64Url(envelope.ciphertext),
        );
        const payload = validateVaultPayloadText(payloadText);
        unlocked = {
          vaultName: record.vaultName,
          revision: record.revision,
          lockEpoch: record.lockEpoch,
          kek,
          payload,
        };
      } catch (error) {
        // A KEK derived during a failed unlock must never survive the call.
        kek.fill(0);
        throw error;
      }
      session = unlocked;
      return statusOf(unlocked);
    },

    lock,

    async getStatus(): Promise<VaultServiceStatus> {
      if (session === null) {
        return { locked: true, vaultName: null, revision: null, lockEpoch: null };
      }
      const fresh = await requireFreshSession();
      return statusOf(fresh.session);
    },

    async getAccounts(): Promise<VaultAccountSummary[]> {
      const fresh = await requireFreshSession();
      const byAccount = new Map<string, VaultAccountSummary>();
      for (const entry of fresh.session.payload.keys) {
        // Shared entry point: normalizeSteemUsername + real isWif + public-key
        // derivation (mock-driven under vitest; real crypto evidence lives in
        // tests/node/vault-wif-real-check.mjs).
        const check = validateVaultWif(entry.privateKey, entry.accountName);
        const publicKey: VaultPublicKey = {
          accountName: check.accountName,
          role: entry.role,
          publicKey: check.publicKey,
        };
        const existing = byAccount.get(check.accountName);
        if (existing) {
          existing.keys.push(publicKey);
        } else {
          byAccount.set(check.accountName, {
            accountName: check.accountName,
            keys: [publicKey],
            balances: null,
          });
        }
      }
      return [...byAccount.values()];
    },

    async mutatePayload(mutator: (draft: VaultPayloadV1) => void): Promise<VaultServiceStatus> {
      const fresh = await requireFreshSession();
      const draft = clonePayload(fresh.session.payload);
      // A throwing mutator changes nothing: no write, session untouched.
      mutator(draft);
      const payloadText = JSON.stringify(draft);
      // Validation failure = rollback by construction: nothing was written and
      // the session keeps its ORIGINAL payload.
      const validated = validateVaultPayloadText(payloadText);
      const freshIv = generateVaultIv();
      const ciphertext = encodeBase64Url(
        await encryptVaultText(fresh.session.kek, freshIv, payloadText),
      );
      const nextRecord: VaultRecordV1 = {
        ...fresh.record,
        iv: encodeBase64Url(freshIv),
        ciphertext,
        // revision +1 is the persisted-payload-change counter; lockEpoch and
        // salt are intentionally untouched.
        revision: fresh.record.revision + 1,
        updatedAt: Date.now(),
      };
      try {
        await registry.swapRecord(
          {
            vaultName: fresh.session.vaultName,
            revision: fresh.session.revision,
            lockEpoch: fresh.session.lockEpoch,
          },
          nextRecord,
        );
      } catch (error) {
        const stale =
          error instanceof VaultError &&
          (error.code === 'VAULT_SESSION_STALE' || error.code === 'VAULT_NOT_FOUND');
        // Clear only when THIS session is still the one that went stale — a
        // concurrent unlock()/lock() may have replaced it in the meantime.
        if (
          stale &&
          session !== null &&
          session.vaultName === fresh.session.vaultName &&
          session.revision === fresh.session.revision &&
          session.lockEpoch === fresh.session.lockEpoch
        ) {
          clearSessionMemory();
        }
        throw error;
      }
      // Adopt the new state only if the session was not cleared/replaced while
      // the CAS was in flight (acceleration event, concurrent lock).
      if (
        session !== null &&
        session.vaultName === fresh.session.vaultName &&
        session.revision === fresh.session.revision &&
        session.lockEpoch === fresh.session.lockEpoch
      ) {
        session = {
          vaultName: fresh.session.vaultName,
          revision: nextRecord.revision,
          lockEpoch: fresh.session.lockEpoch,
          kek: fresh.session.kek,
          payload: validated,
        };
      }
      channel?.postMessage({
        kind: 'vault-mutate',
        key: vaultNameComparisonKey(fresh.session.vaultName),
      });
      return {
        locked: false,
        vaultName: fresh.session.vaultName,
        revision: nextRecord.revision,
        lockEpoch: fresh.session.lockEpoch,
      };
    },

    destroy(): void {
      clearSessionMemory();
      channel?.close();
      channel = null;
    },
  };
}
