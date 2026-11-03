// Vault registry tests (A2). Storage runs on the hand-written fake IndexedDB
// (tests/mocks/fake-indexeddb.ts) — read its FIDELITY BOUNDARY header before
// trusting concurrency cases: single shared state per database name, FIFO
// transaction queue approximating IDB writer serialization, JSON-clone on
// read/write. Real browser multi-tab semantics are covered by the service's
// re-read-before-every-operation hard line and later e2e tests, not here.
//
// Performance: PBKDF2 600k costs ~0.7s per derivation on CI-class hardware.
// Only `createVault` calls that pass the cheap uniqueness pre-check derive
// (7 in this file: Work ×3 — create, listRecords, case-fold uniqueness;
// Café ×2 — create, NFC/NFD uniqueness; Race + race — the racing creates);
// every other conflict/validation/CAS case either fails before crypto or
// operates on seeded rows built from the fixed vectors.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  VAULT_DB_NAME,
  VAULT_STORE_SETTINGS,
  openVaultRegistry,
  vaultRecordToEnvelope,
  type VaultRegistry,
} from '@/lib/vault/registry';
import { VaultError } from '@/lib/vault/errors';
import type { VaultRecordV1 } from '@/lib/vault/types';

const v = vectors.vault;
const PASSWORD_OK = 'a-fine-long-vault-passphrase';

let fakeClock = 1_700_000_000_000;

/** Build a well-formed record from fixture envelope fields (no crypto cost). */
function makeRecord(vaultName: string, overrides: Partial<VaultRecordV1> = {}): VaultRecordV1 {
  return {
    version: 1,
    vaultName,
    salt: v.salt,
    iv: v.iv,
    ciphertext: v.ciphertext,
    revision: 0,
    lockEpoch: 0,
    createdAt: fakeClock++,
    updatedAt: fakeClock++,
    lastBackupAt: null,
    ...overrides,
  };
}

describe('vault registry on the fake IndexedDB', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
  });

  describe('create / read / list', () => {
    it('createVault persists a valid record and getRecord reads it back unchanged', async () => {
      const created = await registry.createVault({ vaultName: 'Work', password: PASSWORD_OK });
      expect(created.version).toBe(1);
      expect(created.vaultName).toBe('Work');
      expect(created.revision).toBe(0);
      expect(created.lockEpoch).toBe(0);
      expect(created.lastBackupAt).toBeNull();
      expect(Number.isSafeInteger(created.createdAt)).toBe(true);
      expect(Number.isSafeInteger(created.updatedAt)).toBe(true);
      // Fresh random material — not the fixture's.
      expect(created.salt).not.toBe(v.salt);
      expect(created.iv).not.toBe(v.iv);
      // The five envelope fields are structurally valid.
      expect(() => vaultRecordToEnvelope(created)).not.toThrow();

      await expect(registry.getRecord('Work')).resolves.toEqual(created);
      // Lookup is by NFC display name: different case is a different key.
      await expect(registry.getRecord('work')).resolves.toBeNull();
    }, 20000);

    it('createVault stores the NFC display value and NFD lookups find it', async () => {
      const created = await registry.createVault({ vaultName: 'Cafe\u0301', password: PASSWORD_OK });
      expect(created.vaultName).toBe('Café'); // NFC display value
      await expect(registry.getRecord('Café')).resolves.toEqual(created);
      await expect(registry.getRecord('Cafe\u0301')).resolves.toEqual(created);
    }, 20000);

    it('listRecords returns comparison-key-ordered validated records', async () => {
      const work = await registry.createVault({ vaultName: 'Work', password: PASSWORD_OK });
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('zz-top'));
      const listed = await registry.listRecords();
      expect(listed.map((r) => r.vaultName)).toEqual(['Work', 'zz-top']);
      expect(listed[0]).toEqual(work);
    }, 20000);
  });

  describe('atomic alias uniqueness', () => {
    it('rejects Work vs work (case-fold collision) with VAULT_NAME_EXISTS', async () => {
      await registry.createVault({ vaultName: 'Work', password: PASSWORD_OK });
      await expect(
        registry.createVault({ vaultName: 'work', password: PASSWORD_OK }),
      ).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
      expect((await registry.listRecords()).length).toBe(1);
    }, 20000);

    it('rejects NFC vs NFD Café collision with VAULT_NAME_EXISTS', async () => {
      await registry.createVault({ vaultName: 'Café', password: PASSWORD_OK });
      await expect(
        registry.createVault({ vaultName: 'Cafe\u0301', password: PASSWORD_OK }),
      ).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
      expect((await registry.listRecords()).length).toBe(1);
    }, 20000);

    it('racing creators with colliding names: exactly one wins (serialized transactions)', async () => {
      // Both pass the cheap pre-check (neither has written yet), both pay the
      // derivation, then the two readwrite transactions serialize — the second
      // one's in-transaction uniqueness check sees the first one's write.
      const results = await Promise.allSettled([
        registry.createVault({ vaultName: 'Race', password: PASSWORD_OK }),
        registry.createVault({ vaultName: 'race', password: PASSWORD_OK }),
      ]);
      const codes = results.map((r) => (r.status === 'fulfilled' ? 'ok' : r.reason.code));
      expect(codes.filter((c) => c === 'ok').length).toBe(1);
      expect(codes.filter((c) => c === 'VAULT_NAME_EXISTS').length).toBe(1);
      const listed = await registry.listRecords();
      expect(listed.length).toBe(1);
      expect(['Race', 'race']).toContain(listed[0]?.vaultName);
    }, 40000);
  });

  describe('validation is delegated to the shared entry points', () => {
    it.each([
      ['empty name', ''],
      ['leading whitespace', ' demo'],
      ['control character', 'de\u0007mo'],
      ['65 code points', 'a'.repeat(65)],
      ['lone surrogate', '\uD800'],
    ])('rejects %s with VAULT_NAME_INVALID before touching storage', async (_msg, name) => {
      await expect(
        registry.createVault({ vaultName: name, password: PASSWORD_OK }),
      ).rejects.toMatchObject({ code: 'VAULT_NAME_INVALID' });
      expect((await registry.listRecords()).length).toBe(0);
    });

    it.each([
      ['too short (length path)', 'short'],
      ['common password on the blocklist (list path)', 'correct horse battery staple'],
    ])('rejects a %s with VAULT_PASSWORD_WEAK and persists nothing', async (_msg, password) => {
      await expect(
        registry.createVault({ vaultName: 'Work', password }),
      ).rejects.toMatchObject({ code: 'VAULT_PASSWORD_WEAK' });
      expect((await registry.listRecords()).length).toBe(0);
    });
  });

  describe('rename', () => {
    beforeEach(() => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Rename Me'));
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Other'));
    });

    it('allows a case-only rename of the same record and preserves envelope + counters', async () => {
      const before = await registry.getRecord('Rename Me');
      const renamed = await registry.renameVault('Rename Me', 'rename me');
      expect(renamed.vaultName).toBe('rename me');
      expect(renamed.salt).toBe(before?.salt);
      expect(renamed.iv).toBe(before?.iv);
      expect(renamed.ciphertext).toBe(before?.ciphertext);
      expect(renamed.revision).toBe(before?.revision);
      expect(renamed.lockEpoch).toBe(before?.lockEpoch);
      await expect(registry.getRecord('Rename Me')).resolves.toBeNull();
      await expect(registry.getRecord('rename me')).resolves.toEqual(renamed);
    });

    it('rejects a rename colliding with another record comparison key', async () => {
      await expect(registry.renameVault('Rename Me', 'OTHER')).rejects.toMatchObject({
        code: 'VAULT_NAME_EXISTS',
      });
      await expect(registry.getRecord('Rename Me')).resolves.not.toBeNull();
      await expect(registry.getRecord('Other')).resolves.not.toBeNull();
    });

    it('rejects a rename of a missing record with VAULT_NOT_FOUND', async () => {
      await expect(registry.renameVault('ghost', 'Whatever')).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
    });

    it('rejects an invalid new name with VAULT_NAME_INVALID and keeps the old record', async () => {
      await expect(registry.renameVault('Rename Me', ' bad')).rejects.toMatchObject({
        code: 'VAULT_NAME_INVALID',
      });
      await expect(registry.getRecord('Rename Me')).resolves.not.toBeNull();
    });

    it('moves the settings active pointer along with the renamed vault', async () => {
      // The pointer matches the vault by comparison key ('rename me' ≡
      // 'Rename Me'), so the rename must carry it to the new display name.
      await registry.putSettings({ schemaVersion: 1, signingMode: 'privateKey', activeVaultName: 'rename me' });
      await registry.renameVault('Rename Me', 'Renamed');
      await expect(registry.getSettings()).resolves.toEqual({
        schemaVersion: 1,
        signingMode: 'privateKey',
        activeVaultName: 'Renamed',
      });
    });

    it('aborts the transaction when the settings row is corrupt mid-rename (no partial writes on real IDB)', async () => {
      // The rename has ALREADY issued its delete+put when the corrupt
      // settings row fails validation — without an explicit abort, real
      // IndexedDB would auto-commit that task and persist the partial write.
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Rename Me'));
      fake.seed(
        VAULT_DB_NAME,
        VAULT_STORE_SETTINGS,
        { schemaVersion: 9, signingMode: 'vault', activeVaultName: 'Rename Me' },
        'settings',
      );
      const abortsBefore = fake.abortCount();
      await expect(registry.renameVault('Rename Me', 'Renamed')).rejects.toMatchObject({
        code: 'VAULT_PAYLOAD_INVALID',
      });
      expect(fake.abortCount() - abortsBefore).toBe(1);
      // The fake does not roll back writes on abort (its fidelity boundary)
      // — the abort() call itself is the guarantee real IndexedDB needs to
      // discard the mid-transaction delete+put above.
    });
  });

  describe('remove', () => {
    it('deletes the record and clears a dangling active pointer atomically', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Doomed'));
      await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'Doomed' });
      await registry.removeVault('Doomed');
      await expect(registry.getRecord('Doomed')).resolves.toBeNull();
      expect((await registry.listRecords()).length).toBe(0);
      await expect(registry.getSettings()).resolves.toEqual({
        schemaVersion: 1,
        signingMode: 'vault',
        activeVaultName: null,
      });
    });

    it('removing an unrelated vault leaves the active pointer alone', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Doomed'));
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Kept'));
      await registry.putSettings({ schemaVersion: 1, signingMode: 'privateKey', activeVaultName: 'Kept' });
      await registry.removeVault('Doomed');
      await expect((await registry.getSettings()).activeVaultName).toBe('Kept');
    });

    it('removing a missing record rejects with VAULT_NOT_FOUND', async () => {
      await expect(registry.removeVault('ghost')).rejects.toBeInstanceOf(VaultError);
      await expect(registry.removeVault('ghost')).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
    });
  });

  describe('settings', () => {
    it('returns defaults when nothing is stored', async () => {
      await expect(registry.getSettings()).resolves.toEqual({
        schemaVersion: 1,
        signingMode: 'privateKey',
        activeVaultName: null,
      });
    });

    it('persists and reads back a full settings row', async () => {
      await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'Work' });
      await expect(registry.getSettings()).resolves.toEqual({
        schemaVersion: 1,
        signingMode: 'vault',
        activeVaultName: 'Work',
      });
    });

    it('rejects malformed typed input with TypeError (programmer error)', async () => {
      await expect(
        registry.putSettings({ schemaVersion: 1, signingMode: 'weird' as 'vault', activeVaultName: null }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        registry.putSettings({ schemaVersion: 2, signingMode: 'vault', activeVaultName: null } as unknown as Parameters<typeof registry.putSettings>[0]),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 42 } as unknown as Parameters<typeof registry.putSettings>[0]),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it('fails closed on a corrupt stored settings row (unknown schema version)', async () => {
      fake.seed(
        VAULT_DB_NAME,
        VAULT_STORE_SETTINGS,
        { schemaVersion: 9, signingMode: 'vault', activeVaultName: null },
        'settings',
      );
      await expect(registry.getSettings()).rejects.toMatchObject({
        code: 'VAULT_PAYLOAD_INVALID',
      });
    });
  });

  describe('revision CAS (swapRecord)', () => {
    const seedCas = async (): Promise<VaultRecordV1> => {
      const record = makeRecord('Cas', { revision: 3, lockEpoch: 5 });
      fake.seed(VAULT_DB_NAME, 'vaults', record);
      return record;
    };

    it('writes when the expected createdAt/revision/lockEpoch match, persisting revision+1', async () => {
      const seeded = await seedCas();
      const next = makeRecord('Cas', {
        revision: 4,
        lockEpoch: 5,
        iv: v.reencryption.iv,
        ciphertext: v.reencryption.ciphertext,
      });
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          next,
        ),
      ).resolves.toEqual(next);
      const stored = await registry.getRecord('Cas');
      expect(stored?.revision).toBe(4);
      expect(stored?.iv).toBe(v.reencryption.iv);
      expect(stored?.ciphertext).toBe(v.reencryption.ciphertext);
      expect(stored?.salt).toBe(v.salt); // untouched
    });

    it('rejects a stale revision and leaves the stored record untouched', async () => {
      const seeded = await seedCas();
      // First writer moves the revision to 4…
      await registry.swapRecord(
        { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
        makeRecord('Cas', { revision: 4, lockEpoch: 5, ciphertext: v.reencryption.ciphertext }),
      );
      // …the second writer still expects 3 and must lose.
      const secondNext = makeRecord('Cas', { revision: 4, lockEpoch: 5, ciphertext: v.emptyPayload.ciphertext });
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          secondNext,
        ),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      const stored = await registry.getRecord('Cas');
      expect(stored?.revision).toBe(4);
      expect(stored?.ciphertext).toBe(v.reencryption.ciphertext);
    });

    it('rejects a stale lockEpoch even when the revision matches (a lock moved it)', async () => {
      const seeded = await seedCas();
      await registry.bumpLockEpoch('Cas'); // lockEpoch 5 → 6, revision stays 3
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          makeRecord('Cas', { revision: 4, lockEpoch: 5 }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    });

    it('rejects a swap against a recreated same-name record even when both counters match (createdAt identity)', async () => {
      // The remove+recreate attack on the CAS: the recreated record restarts
      // at revision 0/lockEpoch 0, so a pointer holding the OLD record's 0/0
      // counters would hit — only the createdAt comparison rejects it.
      const first = makeRecord('Cas', { revision: 0, lockEpoch: 0 });
      fake.seed(VAULT_DB_NAME, 'vaults', first);
      await registry.removeVault('Cas');
      const recreated = makeRecord('Cas', {
        revision: 0,
        lockEpoch: 0,
        ciphertext: v.reencryption.ciphertext,
      });
      fake.seed(VAULT_DB_NAME, 'vaults', recreated);
      expect(recreated.createdAt).not.toBe(first.createdAt); // distinct instances
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: first.createdAt, revision: 0, lockEpoch: 0 },
          makeRecord('Cas', { revision: 1, lockEpoch: 0, createdAt: first.createdAt }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      // The recreated record is untouched — no ciphertext pollution.
      const stored = await registry.getRecord('Cas');
      expect(stored?.createdAt).toBe(recreated.createdAt);
      expect(stored?.ciphertext).toBe(recreated.ciphertext);
      expect(stored?.revision).toBe(0);
    });

    it('rejects a swap for a missing record with VAULT_NOT_FOUND', async () => {
      await expect(
        registry.swapRecord(
          { vaultName: 'ghost', createdAt: 1, revision: 0, lockEpoch: 0 },
          makeRecord('ghost', { revision: 1 }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    });

    it('enforces the programmer-error contract with TypeError', async () => {
      const seeded = await seedCas();
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          makeRecord('Other', { revision: 4, lockEpoch: 5 }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          makeRecord('Cas', { revision: 5, lockEpoch: 5 }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          makeRecord('Cas', { revision: 4, lockEpoch: 6 }),
        ),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it('validates the next record envelope before any write', async () => {
      const seeded = await seedCas();
      // 20 alphabet chars decode to 15 bytes — below the 16-byte GCM floor.
      const bad = makeRecord('Cas', { revision: 4, lockEpoch: 5, ciphertext: 'A'.repeat(20) });
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: seeded.createdAt, revision: 3, lockEpoch: 5 },
          bad,
        ),
      ).rejects.toMatchObject({ code: 'VAULT_ENVELOPE_INVALID' });
      const stored = await registry.getRecord('Cas');
      expect(stored?.revision).toBe(3);
      expect(stored?.ciphertext).toBe(v.ciphertext);
    });
  });

  describe('bumpLockEpoch', () => {
    it('increments lockEpoch without touching revision or the envelope', async () => {
      const seeded = makeRecord('Locker', { revision: 7, lockEpoch: 2 });
      fake.seed(VAULT_DB_NAME, 'vaults', seeded);
      const bumped = await registry.bumpLockEpoch('Locker');
      expect(bumped.lockEpoch).toBe(3);
      expect(bumped.revision).toBe(7);
      expect(bumped.salt).toBe(seeded.salt);
      expect(bumped.iv).toBe(seeded.iv);
      expect(bumped.ciphertext).toBe(seeded.ciphertext);
      expect(bumped.updatedAt).toBeGreaterThanOrEqual(seeded.updatedAt);
      await expect(registry.bumpLockEpoch('missing')).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
    });
  });

  describe('stored-row integrity', () => {
    it('passes envelope fields through byte-identically (salt/iv/ciphertext untouched)', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Frozen', { revision: 7, lockEpoch: 9 }));
      const record = await registry.getRecord('Frozen');
      expect(record?.salt).toBe(v.salt);
      expect(record?.iv).toBe(v.iv);
      expect(record?.ciphertext).toBe(v.ciphertext);
      expect(record?.revision).toBe(7);
      expect(record?.lockEpoch).toBe(9);
    });

    it('fails closed on a corrupt envelope in a stored row', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Broken', { ciphertext: 'A'.repeat(20) }));
      await expect(registry.getRecord('Broken')).rejects.toMatchObject({
        code: 'VAULT_ENVELOPE_INVALID',
      });
    });

    it('fails closed on a stored row missing runtime fields', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', {
        version: 1,
        vaultName: 'Half',
        salt: v.salt,
        iv: v.iv,
        ciphertext: v.ciphertext,
      });
      await expect(registry.getRecord('Half')).rejects.toMatchObject({
        code: 'VAULT_ENVELOPE_INVALID',
      });
    });
  });

  describe('connection lifecycle', () => {
    it('using the registry after close() fails closed with VAULT_STORAGE_UNAVAILABLE', async () => {
      fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Any'));
      registry.close();
      await expect(registry.getRecord('Any')).rejects.toMatchObject({
        code: 'VAULT_STORAGE_UNAVAILABLE',
      });
      await expect(registry.listRecords()).rejects.toMatchObject({
        code: 'VAULT_STORAGE_UNAVAILABLE',
      });
      // close() is idempotent.
      expect(() => registry.close()).not.toThrow();
    });
  });
});

describe('vault registry storage fail-closed (no memory fallback)', () => {
  let fake: FakeIndexedDBHandle;

  afterEach(() => {
    fake.uninstall();
    fake.reset();
    // Re-install+uninstall is not needed: uninstall restores the (absent)
    // original descriptor, so jsdom's missing-indexedDB state is back.
  });

  it('rejects with VAULT_STORAGE_UNAVAILABLE when the indexedDB global is missing', async () => {
    fake = installFakeIndexedDB();
    // Hide the global the registry reads at open time.
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    await expect(openVaultRegistry()).rejects.toBeInstanceOf(VaultError);
    await expect(openVaultRegistry()).rejects.toMatchObject({
      code: 'VAULT_STORAGE_UNAVAILABLE',
    });
    // No in-memory pretense of persistence: a rejected open never produces a
    // registry object to call — the only surface is the typed rejection.
  });

  it('rejects when open() throws synchronously', async () => {
    fake = installFakeIndexedDB();
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open: () => {
          throw new Error('boom');
        },
      },
      writable: true,
      configurable: true,
    });
    await expect(openVaultRegistry()).rejects.toMatchObject({
      code: 'VAULT_STORAGE_UNAVAILABLE',
    });
  });

  it('rejects when the open request errors', async () => {
    fake = installFakeIndexedDB();
    type Handlers = Record<string, ((event?: unknown) => void) | null>;
    const brokenRequest: Handlers = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open: () => {
          queueMicrotask(() => {
            brokenRequest.onerror?.(new Error('open failed'));
          });
          return brokenRequest;
        },
      },
      writable: true,
      configurable: true,
    });
    await expect(openVaultRegistry()).rejects.toMatchObject({
      code: 'VAULT_STORAGE_UNAVAILABLE',
    });
  });
});
