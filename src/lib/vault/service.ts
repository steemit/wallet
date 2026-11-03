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
//      re-reads the registry and compares the session's
//      `createdAt`/`revision`/`lockEpoch` triple against the stored record.
//      Any drift (another tab locked, mutated, renamed or removed the vault)
//      clears the local session and rejects with `VAULT_SESSION_STALE`.
//      Binding the session to the record's `createdAt` (its instance
//      identity) is what defeats remove+recreate-same-name: a recreated
//      record's counters restart at 0/0, its `createdAt` does not. Residual
//      window: a recreate landing on the same millisecond as the original
//      `createdAt` is indistinguishable without a random per-record id (a
//      type-contract change, out of scope for V1 — see registry.ts).
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
import { VAULT_DB_NAME, vaultRecordToEnvelope } from './registry';
import type { VaultRegistry } from './registry';
import type { VaultAccountSummary, VaultPayloadV1, VaultPublicKey, VaultRecordV1 } from './types';
import { validateVaultWif, vaultNameComparisonKey } from './validation';

/**
 * BroadcastChannel name shared by all vault service instances of this origin.
 * Deliberately reuses the registry's exported `VAULT_DB_NAME` so the storage
 * and notification namespaces stay defined in one place; messages carry no
 * sensitive material — only an event kind and the target vault's comparison
 * key.
 */
export const VAULT_BROADCAST_CHANNEL = VAULT_DB_NAME;

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
  /**
   * `createdAt` of the record this session unlocked — the record's instance
   * identity. Compared on every session-bound operation so a same-name
   * remove+recreate (whose counters restart at 0/0) cannot adopt this
   * session.
   */
  createdAt: number;
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
   * PBKDF2 derivation → authenticated decrypt → payload validation → a
   * registry RE-CHECK (the derivation takes ~a second; if the record was
   * removed or its revision/`createdAt` moved meanwhile, the unlock fails
   * with `VAULT_SESSION_STALE` instead of returning a session that is born
   * stale) → hold the session in the closure. If ANY session is currently
   * active (same or another vault) it is locked COMPLETELY first — switching
   * clears.
   *
   * Failures: `VAULT_NOT_FOUND`, `VAULT_ENVELOPE_INVALID` (corrupt stored
   * envelope), `VAULT_PASSWORD_INVALID` (empty password or GCM authentication
   * failure — wrong password and tampering are indistinguishable by design),
   * `VAULT_PAYLOAD_INVALID`/`VAULT_LIMIT_EXCEEDED` (decrypted payload fails
   * validation), `VAULT_SESSION_STALE` (concurrent removal/rename/mutation
   * detected by the re-check). A KEK derived during a failed unlock is
   * zeroized before the error propagates.
   */
  unlock(vaultName: string, password: string): Promise<VaultServiceStatus>;

  /**
   * Lock the active session (idempotent when already locked). Order matters:
   * memory first (KEK `fill(0)` + drop all references), then persistence
   * (`lockEpoch` +1 so other tabs' sessions for this vault go stale), then
   * broadcast the acceleration event. If the persistence step fails, this tab
   * is still locked, the acceleration event is STILL broadcast (other tabs
   * must not silently keep their sessions just because the epoch bump could
   * not be persisted) and the error propagates to the caller.
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
   *   1. hard-line freshness check (re-read + createdAt/revision/lockEpoch
   *      compare),
   *   2. the mutator runs against a COPY of the session payload (throws
   *      propagate with nothing written and the session untouched),
   *   3. the serialized result is validated (`VAULT_PAYLOAD_INVALID` /
   *      `VAULT_LIMIT_EXCEEDED` — on failure NOTHING is written and the
   *      session keeps its original payload; that is the rollback semantics),
   *   4. whole-payload re-encryption with a FRESH IV and the session KEK
   *      (salt unchanged — new salts belong to password changes),
   *   5. CAS write: revision +1; a concurrent change (including a
   *      remove+recreate under the same name, caught by the pointer's
   *      `createdAt`) rejects with `VAULT_SESSION_STALE` and clears the
   *      session.
   *
   * On success the session adopts the new payload and revision — using the
   * LIVE session's KEK, never an await-time snapshot (if the session was
   * destroyed and re-unlocked while the CAS was in flight, the snapshot's
   * bytes were zeroized) — and a `vault-mutate` acceleration event is
   * broadcast. The returned status describes the service's CURRENT session:
   * when the session was cleared or replaced concurrently, it reports that
   * state rather than the completed write's revision.
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
 * Whether the live session is still the same logical session a snapshot was
 * taken from: the same vault record instance (`createdAt`) at the same
 * counters. A session cleared or replaced in between does not match. (The
 * only escape is a re-unlock of a same-millisecond remove+recreate — the
 * documented residual window; see the header note.)
 */
function sameIdentity(live: ActiveSession, snapshot: ActiveSession): boolean {
  return (
    live.vaultName === snapshot.vaultName &&
    live.createdAt === snapshot.createdAt &&
    live.revision === snapshot.revision &&
    live.lockEpoch === snapshot.lockEpoch
  );
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
   * The hard line: re-read the registry and verify the session still points
   * at the exact record instance it unlocked — same `createdAt` at the same
   * `revision`/`lockEpoch`. Missing record or drift (including a same-name
   * remove+recreate) → clear memory, reject `VAULT_SESSION_STALE`. Also
   * rejects `VAULT_LOCKED` when no session exists (or one was cleared while
   * awaiting, e.g. by an acceleration event landing mid-operation).
   */
  async function requireFreshSession(): Promise<FreshSession> {
    if (session === null) {
      throw locked();
    }
    const snapshot = session;
    const record = await registry.getRecord(snapshot.vaultName);
    if (
      record === null ||
      record.createdAt !== snapshot.createdAt ||
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
    // resurrect the session. The acceleration broadcast runs in a finally so
    // a persistence failure still notifies other tabs — without it they would
    // see no epoch change AND no message and silently stay unlocked.
    try {
      await registry.bumpLockEpoch(vaultName);
    } finally {
      channel?.postMessage({
        kind: 'vault-lock',
        key: vaultNameComparisonKey(vaultName),
      });
    }
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
        // Narrow the concurrent-modification window: derivation + decryption
        // take ~a second, during which the record may have been removed,
        // renamed away or swapped. A session born stale must fail NOW, not on
        // its next operation. (lockEpoch is deliberately not compared: a
        // concurrent lock does not change what was decrypted, and the born-
        // stale epoch is caught by the hard line on the next operation.)
        const current = await registry.getRecord(record.vaultName);
        if (
          current === null ||
          current.createdAt !== record.createdAt ||
          current.revision !== record.revision
        ) {
          throw sessionStale();
        }
        unlocked = {
          vaultName: record.vaultName,
          createdAt: record.createdAt,
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
            createdAt: fresh.session.createdAt,
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
        if (stale && session !== null && sameIdentity(session, fresh.session)) {
          clearSessionMemory();
        }
        throw error;
      }
      // Adopt the new state only if the session was not cleared/replaced while
      // the CAS was in flight (acceleration event, concurrent lock, destroy).
      if (session !== null && sameIdentity(session, fresh.session)) {
        session = {
          vaultName: fresh.session.vaultName,
          createdAt: fresh.session.createdAt,
          revision: nextRecord.revision,
          lockEpoch: fresh.session.lockEpoch,
          // The LIVE session's KEK, never the await-time snapshot: when this
          // session object is a re-unlock that replaced a destroyed one
          // mid-CAS, the snapshot's bytes were already zeroized by the
          // destroy — adopting them would encrypt future writes under an
          // all-zero key and permanently corrupt the vault. Whenever the
          // identity matches, the live KEK derives from the same
          // password+salt and is byte-equal to what this mutation used.
          kek: session.kek,
          payload: validated,
        };
      }
      channel?.postMessage({
        kind: 'vault-mutate',
        key: vaultNameComparisonKey(fresh.session.vaultName),
      });
      // Report the service's current truth: a session cleared or replaced
      // while the CAS was in flight must not be reported as unlocked at the
      // new revision (the write itself did succeed).
      if (session === null) {
        return { locked: true, vaultName: null, revision: null, lockEpoch: null };
      }
      return statusOf(session);
    },

    destroy(): void {
      clearSessionMemory();
      channel?.close();
      channel = null;
    },
  };
}
