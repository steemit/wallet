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
//   0); `lockEpoch` increments once per lock. They are compared together by
//   `swapRecord` (CAS) and by the service before every session-bound
//   operation — the cross-tab invalidation hard line.
// - All name/password rules come from ./validation.ts (shared entry points —
//   never re-implemented here). Lookups normalize with NFC only; create and
//   rename validate fully.
// - Fail closed: a missing `indexedDB` global, a failed `open`, or a failed
//   transaction rejects with `VAULT_STORAGE_UNAVAILABLE`. There is NO
//   in-memory fallback pretending to be persistence.
// - The registry never retains a KEK: `createVault` derives one, encrypts the
//   empty payload, zeroizes the bytes (`fill(0)`) and drops the reference in
//   the same scope.
//
// SENSITIVE-DATA RULES: records carry only envelope fields (ciphertext) and
// non-secret runtime state. Error messages never echo vault names, passwords,
// salts, IVs, ciphertext or derived keys.
import { encodeBase64Url, validateVaultEnvelope } from './envelope';
import { deriveVaultKek, encryptVaultText, generateVaultIv, generateVaultSalt } from './crypto';
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

/** Initial payload of a freshly created vault — an empty key list. */
const EMPTY_PAYLOAD_TEXT = '{"keys":[]}';

/**
 * Identifies the exact stored revision a CAS writer observed: a vault name
 * plus the `revision`/`lockEpoch` pair current at read time. If either number
 * moved since, the writer's view is stale.
 */
export interface VaultRevisionPointer {
  vaultName: string;
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
   * alias uniqueness (`VAULT_NAME_EXISTS`), a fresh salt/IV, and the empty
   * payload encrypted with a KEK derived from the password. The KEK is
   * zeroized inside this call and never stored or returned. The returned
   * record has `revision: 0, lockEpoch: 0`.
   *
   * A cheap uniqueness pre-check runs before the (expensive) PBKDF2 derivation
   * so a duplicate name never pays for crypto; the authoritative check + write
   * still happen together in one transaction.
   */
  createVault(params: { vaultName: string; password: string }): Promise<VaultRecordV1>;

  /**
   * Atomic compare-and-swap write. Persists `next` only when the stored record
   * for `expected.vaultName` still has exactly `expected.revision` and
   * `expected.lockEpoch`; otherwise `VAULT_SESSION_STALE` (or
   * `VAULT_NOT_FOUND` when the record is gone). Enforces the programmer-error
   * contract (`TypeError`): `next.vaultName` must equal `expected.vaultName`,
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

/**
 * Extract and validate the five `VaultEnvelopeV1` fields of a record (fail
 * closed with `VAULT_ENVELOPE_INVALID`). The envelope view is what unlock,
 * export and backup consume — runtime fields (revision/lockEpoch/timestamps)
 * never enter it.
 */
export function vaultRecordToEnvelope(record: VaultRecordV1): VaultEnvelopeV1 {
  return validateVaultEnvelope({
    version: record.version,
    vaultName: record.vaultName,
    salt: record.salt,
    iv: record.iv,
    ciphertext: record.ciphertext,
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
 * Fail-closed validation of a raw stored row into a `VaultRecordV1`: the five
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
    iv: raw['iv'],
    ciphertext: raw['ciphertext'],
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
 * `VAULT_STORAGE_UNAVAILABLE`. Because every mutating primitive throws BEFORE
 * issuing its write request, a `run` that rejects leaves no partial writes.
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
    if (error instanceof VaultError || error instanceof TypeError) {
      throw error;
    }
    throw storageUnavailable('transaction failed');
  }
}

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
      const iv = generateVaultIv();
      const kek = await deriveVaultKek(params.password, salt);
      let ciphertext: string;
      try {
        ciphertext = encodeBase64Url(await encryptVaultText(kek, iv, EMPTY_PAYLOAD_TEXT));
      } finally {
        // The registry never retains the KEK: zeroize the bytes and let the
        // reference go out of scope. (The password string itself cannot be
        // physically zeroed — dropping the argument reference is the best
        // JavaScript can do.)
        kek.fill(0);
      }
      const now = Date.now();
      const record: VaultRecordV1 = {
        version: 1,
        vaultName: displayName,
        salt: encodeBase64Url(salt),
        iv: encodeBase64Url(iv),
        ciphertext,
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
