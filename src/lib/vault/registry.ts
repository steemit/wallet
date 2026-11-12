// IndexedDB-backed vault registry (A2) — persistent storage for
// `VaultRecordV1` rows (object store `vaults`, keyPath `vaultName`) and the
// singleton `VaultSettingsV1` row (object store `settings`, fixed key).
//
// DESIGN DECISIONS (see docs/AI-driver/09-vault.md extension checklist):
//
// - Alias uniqueness is enforced by comparing `vaultNameComparisonKey` values
//   inside ONE `readwrite` transaction that also performs the write. IndexedDB
//   serializes transactions on the same store, so the check-then-act pair is
//   atomic. A `unique` index was deliberately NOT used: it would require
//   persisting a comparison-key field inside `VaultRecordV1`, which is not
//   part of the type contract (and the comparison key is neither the vault
//   identity nor envelope/AAD material).
// - `revision` increments once per persisted PAYLOAD change (create starts at
//   0); `lockEpoch` increments once per lock. Together with `createdAt` (the
//   record's instance identity) they are compared by `swapRecord` (CAS) and
//   by the service before every session-bound operation — the cross-tab
//   invalidation hard line. Binding to `createdAt` is what defeats the
//   remove+recreate-same-name attack on that line: a recreated record's
//   counters restart at 0/0, but its `createdAt` differs.
// - All name/password rules come from ./validation.ts (shared entry points —
//   never re-implemented here). Lookups normalize with NFC only; create and
//   rename validate fully.
// - Fail closed: a missing `indexedDB` global, a failed `open`, or a failed
//   transaction rejects with `VAULT_STORAGE_UNAVAILABLE`. There is NO
//   in-memory fallback pretending to be persistence.
// - The registry never touches a KEK: `createVault` stores an empty key list
//   under a fresh salt — zero keys exist at creation, so there is no
//   ciphertext yet. Key sealing (and the per-operation KEK derivation and
//   zeroization) happens in the service layer when keys are added.
//
// SENSITIVE-DATA RULES: records carry only envelope fields (ciphertext) and
// non-secret runtime state. Error messages never echo vault names, passwords,
// salts, IVs, ciphertext or derived keys.
import { encodeBase64Url, validateVaultEnvelope } from './envelope';
import { generateVaultSalt } from './crypto';
import { VaultError } from './errors';
import { validateVaultName, validateVaultPassword, vaultNameComparisonKey } from './validation';
import type { VaultEnvelopeV1, VaultRecordV1, VaultSettingsV1 } from './types';

/** Database name. The BroadcastChannel in ./service.ts reuses this string. */
export const VAULT_DB_NAME = 'steem-wallet-vault';

/** Schema version. Bumping requires a migration path (out of scope for A2). */
export const VAULT_DB_VERSION = 1;

/** Object store holding one `VaultRecordV1` per vault, keyed by display name. */
export const VAULT_STORE_VAULTS = 'vaults';

/** Object store holding the singleton `VaultSettingsV1` row. */
export const VAULT_STORE_SETTINGS = 'settings';

/** Fixed key of the single row inside the `settings` store. */
const SETTINGS_KEY = 'settings';

/**
 * Identifies the exact stored revision a CAS writer observed: a vault name
 * plus the `createdAt`/`revision`/`lockEpoch` triple current at read time. If
 * any of the three moved since the read — including a same-name
 * remove+recreate whose counters restart at 0/0 but whose `createdAt` differs —
 * the writer's view is stale.
 *
 * KNOWN RESIDUAL WINDOW: a remove+recreate whose `Date.now()` lands on the
 * exact same millisecond as the original record's `createdAt` is
 * indistinguishable from the original record. Closing that requires a random
 * per-record id (a `VaultRecordV1` type-contract change), deliberately out of
 * scope for V1; binding sessions to (createdAt, revision, lockEpoch) closes
 * every other counter-reset collision.
 */
export interface VaultRevisionPointer {
  vaultName: string;
  /** Creation timestamp of the observed record — its instance identity. */
  createdAt: number;
  revision: number;
  lockEpoch: number;
}

/**
 * Primitive storage surface consumed by the unlock-session service (A2) and
 * the vault manager (A4). Every mutating primitive runs its reads and writes
 * inside a single `readwrite` transaction and throws BEFORE issuing any write
 * request when a validation fails — an aborted-by-exception transaction never
 * leaves partial writes behind.
 */
export interface VaultRegistry {
  /**
   * All vault records, ordered by alias comparison key for stable display.
   * Each returned record has passed fail-closed validation.
   */
  listRecords(): Promise<VaultRecordV1[]>;

  /**
   * Fetch one record by name (input is NFC-normalized for the lookup; invalid
   * names simply miss). Returns `null` when absent. Rows that fail validation
   * reject with `VAULT_ENVELOPE_INVALID` (corruption fails closed).
   */
  getRecord(vaultName: string): Promise<VaultRecordV1 | null>;

  /**
   * Create a vault: full alias validation (`VAULT_NAME_INVALID`), password
   * strength policy (`VAULT_PASSWORD_WEAK` — this IS the create primitive, the
   * check is not left to callers; flows with extra context such as a known
   * account name should additionally pre-validate with that context), atomic
   * alias uniqueness (`VAULT_NAME_EXISTS`), and a fresh salt. No crypto
   * beyond that: the vault starts with zero keys, so there is no ciphertext
   * yet — the first key added later derives the KEK from the password and
   * seals it (that password is the vault's real anchor). The returned record
   * has `revision: 0, lockEpoch: 0`.
   *
   * A cheap uniqueness pre-check runs before the write transaction so a
   * duplicate name fails fast; the authoritative check + write still happen
   * together in one transaction.
   */
  createVault(params: { vaultName: string; password: string }): Promise<VaultRecordV1>;

  /**
   * Atomic compare-and-swap write. Persists `next` only when the stored record
   * for `expected.vaultName` is the same record instance the writer observed
   * (`createdAt` equal) at exactly `expected.revision` and
   * `expected.lockEpoch`; otherwise `VAULT_SESSION_STALE` (or
   * `VAULT_NOT_FOUND` when the record is gone). The `createdAt` comparison is
   * what rejects a writer that observed a REMOVED record after a same-name
   * recreate reset the counters. Enforces the programmer-error contract
   * (`TypeError`): `next.vaultName` must equal `expected.vaultName`,
   * `next.revision` must be `expected.revision + 1` and `next.lockEpoch` must
   * equal `expected.lockEpoch` — callers build `next` from the record they
   * read. `next`'s envelope fields are validated before any write
   * (`VAULT_ENVELOPE_INVALID`). `updatedAt` is the caller's responsibility.
   */
  swapRecord(expected: VaultRevisionPointer, next: VaultRecordV1): Promise<VaultRecordV1>;

  /**
   * Increment `lockEpoch` (leaving `revision` untouched) and refresh
   * `updatedAt`. Every lock of a vault persists one bump so unlocked sessions
   * for that vault in other tabs become stale. Throws `VAULT_NOT_FOUND` when
   * the record is gone. Returns the updated record.
   */
  bumpLockEpoch(vaultName: string): Promise<VaultRecordV1>;

  /**
   * Rename a vault to a fully validated new display name. Case-only changes of
   * the same record are allowed; colliding with any OTHER record's comparison
   * key rejects with `VAULT_NAME_EXISTS`; a missing record with
   * `VAULT_NOT_FOUND`. Envelope fields, `revision` and `lockEpoch` are
   * preserved; `vaultName` and `updatedAt` change. When the settings row
   * points at the renamed vault, the pointer follows, in the same transaction.
   * A rename invalidates other tabs' unlocked sessions for this vault (their
   * next operation finds no record under the old name → stale).
   */
  renameVault(oldName: string, newName: string): Promise<VaultRecordV1>;

  /**
   * Delete a vault record. Throws `VAULT_NOT_FOUND` when absent (no silent
   * idempotence — callers decide). When the settings row points at the removed
   * vault, the pointer resets to `null`, atomically in the same transaction.
   */
  removeVault(vaultName: string): Promise<void>;

  /**
   * Scan the raw `vaults` store and report every row the standard validation
   * path (`asRecord` — the exact `validateVaultEnvelope` route
   * `getRecord`/`listRecords` run) REJECTS. This exists for INCOMPATIBLE
   * ENVELOPE VERSIONS: devices that ran the never-shipped A5 whole-vault
   * build still hold records the per-key format cannot read, and by design
   * there is NO migration layer (2026-11-05 ruling — the old format was never
   * publicly released). Instead of migrating, the UI offers an explicit purge
   * (see {@link purgeInvalidVaultRecords}) once the user confirms; this
   * read-only primitive lets the UI describe the damage first.
   *
   * Per-record failures are isolated: each row gets its own try/catch around
   * the shared validation, so one unreadable row never fails the whole scan —
   * and the validation logic is REUSED, never re-implemented. Genuine
   * storage-layer failures (request errors, a closed connection) still fail
   * closed with `VAULT_STORAGE_UNAVAILABLE`. Read-only (`readonly`
   * transaction). `vaultName` is the raw stored string when the row carries
   * one, `null` otherwise (the UI filters those out when listing names).
   * `record` is the stored value VERBATIM (unknown shape — this version
   * cannot interpret it): an as-is archival copy for the cleanup dialog to
   * download before {@link purgeInvalidVaultRecords} deletes the rows, never
   * a re-importable backup and never a lookup key.
   */
  listInvalidVaultRecords(): Promise<
    Array<{ key: IDBValidKey; vaultName: string | null; record: unknown }>
  >;

  /**
   * Delete every record that fails the standard validation path (the same
   * verdict as {@link listInvalidVaultRecords}) inside ONE `readwrite`
   * transaction, then reset `activeVaultName` to `null` when it points at a
   * record that is gone or still fails validation. Callers MUST have EXPLICIT
   * USER CONFIRMATION before calling: this is the sanctioned "clear
   * incompatible vault data" escape hatch for the no-migration ruling above —
   * not a routine cleanup — and it deletes ONLY records the normal load path
   * rejects, so readable vaults and every other settings field are untouched.
   * Removed records are unrecoverable. Returns the removed rows' `vaultName`
   * as read from the raw record (`null` when the row carries none). A corrupt
   * settings row still fails closed (`VAULT_PAYLOAD_INVALID`, aborting the
   * transaction) — same discipline as `removeVault`.
   */
  purgeInvalidVaultRecords(): Promise<{ removed: Array<string | null> }>;

  /**
   * Read the settings row; returns defaults
   * (`schemaVersion: 1, signingMode: 'privateKey', activeVaultName: null`)
   * when none is stored yet. A corrupt/unknown-version row rejects with
   * `VAULT_PAYLOAD_INVALID` (fail closed rather than misreading a future
   * schema).
   */
  getSettings(): Promise<VaultSettingsV1>;

  /**
   * Persist the settings row (typed input; malformed input is a programmer
   * error and throws `TypeError`).
   */
  putSettings(settings: VaultSettingsV1): Promise<void>;

  /** Close the underlying connection. The registry must not be used after. */
  close(): void;
}

/** Extract the portable envelope; local concurrency fields never enter backups. */
export function vaultRecordToEnvelope(record: VaultRecordV1): VaultEnvelopeV1 {
  return validateVaultEnvelope({
    version: record.version,
    vaultName: record.vaultName,
    salt: record.salt,
    accounts: record.accounts,
  });
}

function storageUnavailable(reason: string): VaultError {
  return new VaultError('VAULT_STORAGE_UNAVAILABLE', `vault registry storage failure: ${reason}`);
}

function nameExists(): VaultError {
  return new VaultError('VAULT_NAME_EXISTS', 'a vault already exists under that name');
}

function notFound(): VaultError {
  return new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
}

function corruptRecord(): VaultError {
  return new VaultError('VAULT_ENVELOPE_INVALID', 'stored vault record failed validation');
}

function invalidSettingsRow(): VaultError {
  return new VaultError('VAULT_PAYLOAD_INVALID', 'stored vault settings row has an unsupported shape');
}

/** NFC-normalize a name for primary-key lookups (full validation is create/rename-only). */
function normalizeLookupName(vaultName: string): string {
  return vaultName.normalize('NFC');
}

/**
 * Fail-closed validation of a raw stored row into a `VaultRecordV1`: the four
 * envelope fields run through the shared envelope validator and the runtime
 * fields must be non-negative integers (`lastBackupAt` may be null).
 */
function asRecord(value: unknown): VaultRecordV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw corruptRecord();
  }
  const raw = value as Record<string, unknown>;
  const candidate = {
    version: raw['version'],
    vaultName: raw['vaultName'],
    salt: raw['salt'],
    accounts: raw['accounts'],
  };
  const envelope = validateVaultEnvelope(candidate);
  const runtimeShape =
    Number.isSafeInteger(raw['revision']) &&
    (raw['revision'] as number) >= 0 &&
    Number.isSafeInteger(raw['lockEpoch']) &&
    (raw['lockEpoch'] as number) >= 0 &&
    Number.isSafeInteger(raw['createdAt']) &&
    (raw['createdAt'] as number) >= 0 &&
    Number.isSafeInteger(raw['updatedAt']) &&
    (raw['updatedAt'] as number) >= 0 &&
    (raw['lastBackupAt'] === null ||
      (Number.isSafeInteger(raw['lastBackupAt']) && (raw['lastBackupAt'] as number) >= 0));
  if (!runtimeShape) {
    throw corruptRecord();
  }
  return {
    ...envelope,
    revision: raw['revision'] as number,
    lockEpoch: raw['lockEpoch'] as number,
    createdAt: raw['createdAt'] as number,
    updatedAt: raw['updatedAt'] as number,
    lastBackupAt: raw['lastBackupAt'] as number | null,
  };
}

/** Validate every row of a getAll result (fail closed on any corrupt row). */
function asRecords(values: unknown): VaultRecordV1[] {
  if (!Array.isArray(values)) {
    throw corruptRecord();
  }
  return values.map((value) => asRecord(value));
}

/** Find a record whose alias comparison key equals the target's, or null. */
function findByComparisonKey(
  records: VaultRecordV1[],
  name: string,
): VaultRecordV1 | null {
  const key = vaultNameComparisonKey(name);
  for (const record of records) {
    if (vaultNameComparisonKey(record.vaultName) === key) {
      return record;
    }
  }
  return null;
}

/** A raw stored row together with its primary key (getAll/getAllKeys pair). */
interface RawVaultRow {
  key: IDBValidKey;
  value: unknown;
}

/**
 * Read every raw row of the `vaults` store WITH its primary key. Real
 * IndexedDB returns `getAll`/`getAllKeys` in the same order; a length
 * mismatch would be a storage anomaly and fails closed.
 */
async function readRawVaultRows(store: IDBObjectStore): Promise<RawVaultRow[]> {
  const values = await requestToPromise(store.getAll());
  const keys = await requestToPromise(store.getAllKeys());
  if (values.length !== keys.length) {
    throw storageUnavailable('getAll/getAllKeys returned misaligned results');
  }
  return values.map((value, index) => ({ key: keys[index] as IDBValidKey, value }));
}

/**
 * The raw `vaultName` of a stored row, when it is a readable string. Invalid
 * rows are precisely the ones whose shape cannot be trusted, so callers must
 * treat this as display-only information (never a lookup key).
 */
function rawVaultName(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const name = (value as Record<string, unknown>)['vaultName'];
    if (typeof name === 'string') {
      return name;
    }
  }
  return null;
}

/**
 * The per-row purge verdict: run the EXACT validation the normal load path
 * uses (`asRecord`). True when `getRecord`/`listRecords` would reject the
 * row — those, and only those, are the rows the purge may delete. Anything
 * that is not a VaultError is not a data verdict; rethrow it so storage-layer
 * failures keep failing closed.
 */
function isUnreadableRecord(value: unknown): boolean {
  try {
    asRecord(value);
    return false;
  } catch (error) {
    if (error instanceof VaultError) {
      return true;
    }
    throw error;
  }
}

function isSettingsShape(value: unknown): value is VaultSettingsV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    raw['schemaVersion'] === 1 &&
    (raw['signingMode'] === 'privateKey' || raw['signingMode'] === 'vault') &&
    (typeof raw['activeVaultName'] === 'string' || raw['activeVaultName'] === null)
  );
}

/** Validate a settings row read from storage (fail closed on corruption). */
function asSettings(value: unknown): VaultSettingsV1 {
  if (!isSettingsShape(value)) {
    throw invalidSettingsRow();
  }
  return { schemaVersion: 1, signingMode: value.signingMode, activeVaultName: value.activeVaultName };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Run `run` inside one transaction over `storeNames` and wait for its
 * completion (durability). Errors thrown by `run` propagate untouched when
 * they are already `VaultError`/`TypeError` (data vs programmer error — see
 * the crypto.ts precedent); anything else is wrapped as
 * `VAULT_STORAGE_UNAVAILABLE`. A `run` that rejects also ABORTS the
 * transaction: primitives validate before issuing their first write request,
 * but mid-transaction failures (e.g. rename/remove discovering a corrupt
 * settings row AFTER their vault writes) would otherwise be auto-committed by
 * real IndexedDB once the task ends — the explicit abort is what makes
 * "no partial writes on the exception path" a general guarantee.
 */
async function runInTransaction<T>(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  let transaction: IDBTransaction;
  try {
    transaction = db.transaction(storeNames, mode);
  } catch {
    throw storageUnavailable('transaction could not be opened');
  }
  const done = transactionDone(transaction);
  void done.catch(() => undefined); // silence unhandled rejections when `run` throws first
  try {
    const result = await run(transaction);
    await done;
    return result;
  } catch (error) {
    try {
      // Roll back any already-issued writes. Per spec abort() throws
      // InvalidStateError on an already-finished transaction — nothing to
      // roll back then, so swallow that. (The test fake does not roll back
      // on abort — its documented fidelity boundary; the CALL is the
      // guarantee real IndexedDB needs.)
      transaction.abort();
    } catch {
      // already committed or aborted
    }
    if (error instanceof VaultError || error instanceof TypeError) {
      throw error;
    }
    throw storageUnavailable('transaction failed');
  }
}

// TODO(next schema version): wire onversionchange/onblocked (close or surface
// the conflict) when a migration first ships. The DB version is fixed at 1 —
// same-version re-opens never enter version negotiation — so the handlers are
// deliberately omitted here.
function openDatabase(dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      reject(storageUnavailable('IndexedDB is not available in this environment'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(dbName, version);
    } catch {
      reject(storageUnavailable('opening the vault database threw'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE_VAULTS)) {
        db.createObjectStore(VAULT_STORE_VAULTS, { keyPath: 'vaultName' });
      }
      if (!db.objectStoreNames.contains(VAULT_STORE_SETTINGS)) {
        db.createObjectStore(VAULT_STORE_SETTINGS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageUnavailable('opening the vault database failed'));
  });
}

/**
 * Open (creating on first use) the vault database and return the registry
 * primitive surface. Fails closed with `VAULT_STORAGE_UNAVAILABLE` when
 * IndexedDB is missing or the open fails — never falls back to memory.
 */
export async function openVaultRegistry(dbName: string = VAULT_DB_NAME): Promise<VaultRegistry> {
  const db = await openDatabase(dbName, VAULT_DB_VERSION);
  const readAllRecords = (): Promise<VaultRecordV1[]> =>
    runInTransaction(db, [VAULT_STORE_VAULTS], 'readonly', async (transaction) =>
      asRecords(await requestToPromise(transaction.objectStore(VAULT_STORE_VAULTS).getAll())),
    );

  return {
    async listRecords(): Promise<VaultRecordV1[]> {
      const records = await readAllRecords();
      return records.sort((a, b) => {
        const keyA = vaultNameComparisonKey(a.vaultName);
        const keyB = vaultNameComparisonKey(b.vaultName);
        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        return 0;
      });
    },

    async getRecord(vaultName: string): Promise<VaultRecordV1 | null> {
      const key = normalizeLookupName(vaultName);
      return runInTransaction(db, [VAULT_STORE_VAULTS], 'readonly', async (transaction) => {
        const raw = await requestToPromise(transaction.objectStore(VAULT_STORE_VAULTS).get(key));
        return raw === null || raw === undefined ? null : asRecord(raw);
      });
    },

    async createVault(params: { vaultName: string; password: string }): Promise<VaultRecordV1> {
      const displayName = validateVaultName(params.vaultName);
      validateVaultPassword(params.password);
      // Cheap pre-check so a duplicate name never pays the PBKDF2 cost. The
      // authoritative uniqueness check + write run in ONE transaction below —
      // a concurrent creator can still only win once (transactions serialize).
      if (findByComparisonKey(await readAllRecords(), displayName) !== null) {
        throw nameExists();
      }
      const salt = generateVaultSalt();
      const now = Date.now();
      const record: VaultRecordV1 = {
        version: 1,
        vaultName: displayName,
        salt: encodeBase64Url(salt),
        accounts: [],
        revision: 0,
        lockEpoch: 0,
        createdAt: now,
        updatedAt: now,
        lastBackupAt: null,
      };
      return runInTransaction(
        db,
        [VAULT_STORE_VAULTS],
        'readwrite',
        async (transaction) => {
          const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
          const existing = asRecords(await requestToPromise(vaults.getAll()));
          if (findByComparisonKey(existing, displayName) !== null) {
            throw nameExists();
          }
          await requestToPromise(vaults.put(record));
          return record;
        },
      );
    },

    async swapRecord(
      expected: VaultRevisionPointer,
      next: VaultRecordV1,
    ): Promise<VaultRecordV1> {
      if (next.vaultName !== expected.vaultName) {
        throw new TypeError('swapRecord: next.vaultName must equal expected.vaultName');
      }
      if (
        !Number.isSafeInteger(next.revision) ||
        next.revision !== expected.revision + 1
      ) {
        throw new TypeError('swapRecord: next.revision must be expected.revision + 1');
      }
      if (next.lockEpoch !== expected.lockEpoch) {
        throw new TypeError('swapRecord: next.lockEpoch must equal expected.lockEpoch');
      }
      // Fail closed on a malformed envelope BEFORE any write is issued.
      vaultRecordToEnvelope(next);
      const key = normalizeLookupName(expected.vaultName);
      await runInTransaction(db, [VAULT_STORE_VAULTS], 'readwrite', async (transaction) => {
        const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
        const raw = await requestToPromise(vaults.get(key));
        if (raw === null || raw === undefined) {
          throw notFound();
        }
        const current = asRecord(raw);
        if (
          current.createdAt !== expected.createdAt ||
          current.revision !== expected.revision ||
          current.lockEpoch !== expected.lockEpoch
        ) {
          throw new VaultError(
            'VAULT_SESSION_STALE',
            'the vault record changed since it was read; re-read and retry',
          );
        }
        await requestToPromise(vaults.put(next));
      });
      return next;
    },

    async bumpLockEpoch(vaultName: string): Promise<VaultRecordV1> {
      const key = normalizeLookupName(vaultName);
      return runInTransaction(db, [VAULT_STORE_VAULTS], 'readwrite', async (transaction) => {
        const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
        const raw = await requestToPromise(vaults.get(key));
        if (raw === null || raw === undefined) {
          throw notFound();
        }
        const current = asRecord(raw);
        // A lock is not a payload change: revision stays, lockEpoch moves.
        const next: VaultRecordV1 = {
          ...current,
          lockEpoch: current.lockEpoch + 1,
          updatedAt: Date.now(),
        };
        await requestToPromise(vaults.put(next));
        return next;
      });
    },

    async renameVault(oldName: string, newName: string): Promise<VaultRecordV1> {
      const newDisplay = validateVaultName(newName);
      const oldKey = normalizeLookupName(oldName);
      const newComparisonKey = vaultNameComparisonKey(newDisplay);
      return runInTransaction(
        db,
        [VAULT_STORE_VAULTS, VAULT_STORE_SETTINGS],
        'readwrite',
        async (transaction) => {
          const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
          const raw = await requestToPromise(vaults.get(oldKey));
          if (raw === null || raw === undefined) {
            throw notFound();
          }
          const current = asRecord(raw);
          const all = asRecords(await requestToPromise(vaults.getAll()));
          for (const record of all) {
            // Exclude the record being renamed itself: a case-only change of
            // the same vault is always allowed.
            if (
              record.vaultName !== current.vaultName &&
              vaultNameComparisonKey(record.vaultName) === newComparisonKey
            ) {
              throw nameExists();
            }
          }
          const next: VaultRecordV1 = {
            ...current,
            vaultName: newDisplay,
            updatedAt: Date.now(),
          };
          await requestToPromise(vaults.delete(oldKey));
          await requestToPromise(vaults.put(next));
          // Keep the active pointer coherent when it names the renamed vault.
          const settingsStore = transaction.objectStore(VAULT_STORE_SETTINGS);
          const settingsRaw = await requestToPromise(settingsStore.get(SETTINGS_KEY));
          if (settingsRaw !== null && settingsRaw !== undefined) {
            const settings = asSettings(settingsRaw);
            if (
              settings.activeVaultName !== null &&
              vaultNameComparisonKey(settings.activeVaultName) ===
                vaultNameComparisonKey(oldKey)
            ) {
              await requestToPromise(
                settingsStore.put({ ...settings, activeVaultName: newDisplay }, SETTINGS_KEY),
              );
            }
          }
          return next;
        },
      );
    },

    async removeVault(vaultName: string): Promise<void> {
      const key = normalizeLookupName(vaultName);
      await runInTransaction(
        db,
        [VAULT_STORE_VAULTS, VAULT_STORE_SETTINGS],
        'readwrite',
        async (transaction) => {
          const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
          const raw = await requestToPromise(vaults.get(key));
          if (raw === null || raw === undefined) {
            throw notFound();
          }
          await requestToPromise(vaults.delete(key));
          // A dangling active pointer must never outlive its vault; clearing
          // it happens in the same transaction as the delete.
          const settingsStore = transaction.objectStore(VAULT_STORE_SETTINGS);
          const settingsRaw = await requestToPromise(settingsStore.get(SETTINGS_KEY));
          if (settingsRaw !== null && settingsRaw !== undefined) {
            const settings = asSettings(settingsRaw);
            if (
              settings.activeVaultName !== null &&
              vaultNameComparisonKey(settings.activeVaultName) === vaultNameComparisonKey(key)
            ) {
              await requestToPromise(
                settingsStore.put({ ...settings, activeVaultName: null }, SETTINGS_KEY),
              );
            }
          }
        },
      );
    },

    async listInvalidVaultRecords(): Promise<
      Array<{ key: IDBValidKey; vaultName: string | null; record: unknown }>
    > {
      return runInTransaction(db, [VAULT_STORE_VAULTS], 'readonly', async (transaction) => {
        const rows = await readRawVaultRows(transaction.objectStore(VAULT_STORE_VAULTS));
        const invalid: Array<{
          key: IDBValidKey;
          vaultName: string | null;
          record: unknown;
        }> = [];
        for (const row of rows) {
          // Isolated per row: one unreadable record must not hide the rest.
          if (isUnreadableRecord(row.value)) {
            invalid.push({
              key: row.key,
              vaultName: rawVaultName(row.value),
              // Verbatim stored value — the archival copy, not a reshaped one.
              record: row.value,
            });
          }
        }
        return invalid;
      });
    },

    async purgeInvalidVaultRecords(): Promise<{ removed: Array<string | null> }> {
      return runInTransaction(
        db,
        [VAULT_STORE_VAULTS, VAULT_STORE_SETTINGS],
        'readwrite',
        async (transaction) => {
          const vaults = transaction.objectStore(VAULT_STORE_VAULTS);
          const rows = await readRawVaultRows(vaults);
          // Partition BEFORE issuing any delete: a non-VaultError throw during
          // the scan then cannot leave partial deletes behind.
          const unreadable: RawVaultRow[] = [];
          const survivors: VaultRecordV1[] = [];
          for (const row of rows) {
            if (isUnreadableRecord(row.value)) {
              unreadable.push(row);
            } else {
              survivors.push(asRecord(row.value));
            }
          }
          const removed: Array<string | null> = [];
          for (const row of unreadable) {
            await requestToPromise(vaults.delete(row.key));
            removed.push(rawVaultName(row.value));
          }
          // A dangling active pointer must never survive its record; the same
          // comparison-key rule as removeVault decides "dangling" here.
          const settingsStore = transaction.objectStore(VAULT_STORE_SETTINGS);
          const settingsRaw = await requestToPromise(settingsStore.get(SETTINGS_KEY));
          if (settingsRaw !== null && settingsRaw !== undefined) {
            const settings = asSettings(settingsRaw);
            if (
              settings.activeVaultName !== null &&
              findByComparisonKey(survivors, settings.activeVaultName) === null
            ) {
              await requestToPromise(
                settingsStore.put({ ...settings, activeVaultName: null }, SETTINGS_KEY),
              );
            }
          }
          return { removed };
        },
      );
    },

    async getSettings(): Promise<VaultSettingsV1> {
      return runInTransaction(db, [VAULT_STORE_SETTINGS], 'readonly', async (transaction) => {
        const raw = await requestToPromise(
          transaction.objectStore(VAULT_STORE_SETTINGS).get(SETTINGS_KEY),
        );
        if (raw === null || raw === undefined) {
          return { schemaVersion: 1, signingMode: 'privateKey', activeVaultName: null };
        }
        return asSettings(raw);
      });
    },

    async putSettings(settings: VaultSettingsV1): Promise<void> {
      if (!isSettingsShape(settings)) {
        // Typed API receiving garbage = programmer error (crypto.ts precedent).
        throw new TypeError('putSettings: settings must be a well-formed VaultSettingsV1');
      }
      await runInTransaction(db, [VAULT_STORE_SETTINGS], 'readwrite', async (transaction) => {
        await requestToPromise(
          transaction.objectStore(VAULT_STORE_SETTINGS).put(settings, SETTINGS_KEY),
        );
      });
    },

    close(): void {
      db.close();
    },
  };
}
