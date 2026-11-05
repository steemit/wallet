import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  VAULT_DB_NAME,
  VAULT_DB_VERSION,
  VAULT_STORE_SETTINGS,
  openVaultRegistry,
  vaultRecordToEnvelope,
  type VaultRegistry,
} from '@/lib/vault/registry';
import { VaultError } from '@/lib/vault/errors';
import type { VaultRecordV1 } from '@/lib/vault/types';

const v = vectors.vault;
const PASSWORD = 'a-fine-long-vault-passphrase';
let clock = 1_700_000_000_000;

function makeRecord(vaultName: string, overrides: Partial<VaultRecordV1> = {}): VaultRecordV1 {
  return {
    ...v.envelope,
    version: 1,
    vaultName,
    revision: 0,
    lockEpoch: 0,
    createdAt: clock++,
    updatedAt: clock++,
    lastBackupAt: null,
    ...overrides,
  };
}

describe('hierarchical vault registry', () => {
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

  it('creates an empty four-field vault without changing the database schema', async () => {
    const created = await registry.createVault({ vaultName: 'Work', password: PASSWORD });
    expect(created).toMatchObject({
      version: 1,
      vaultName: 'Work',
      accounts: [],
      revision: 0,
      lockEpoch: 0,
      lastBackupAt: null,
    });
    expect(created).not.toHaveProperty('iv');
    expect(created).not.toHaveProperty('ciphertext');
    expect(created.salt).not.toBe(v.salt);
    expect(VAULT_DB_VERSION).toBe(1);
    expect(vaultRecordToEnvelope(created)).toEqual({
      version: 1,
      vaultName: 'Work',
      salt: created.salt,
      accounts: [],
    });
    await expect(registry.getRecord('Work')).resolves.toEqual(created);
  }, 20000);

  it('uses NFC display names, deterministic listing and atomic alias uniqueness', async () => {
    const work = await registry.createVault({ vaultName: 'Work', password: PASSWORD });
    const cafe = await registry.createVault({ vaultName: 'Cafe\u0301', password: PASSWORD });
    expect(cafe.vaultName).toBe('Café');
    await expect(registry.getRecord('Cafe\u0301')).resolves.toEqual(cafe);
    await expect(
      registry.createVault({ vaultName: 'work', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
    await expect(
      registry.createVault({ vaultName: 'Café', password: PASSWORD }),
    ).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
    expect((await registry.listRecords()).map((record) => record.vaultName)).toEqual(['Café', 'Work']);
    expect((await registry.listRecords())[1]).toEqual(work);
  }, 40000);

  it('allows exactly one creator to win a case-fold race', async () => {
    const results = await Promise.allSettled([
      registry.createVault({ vaultName: 'Race', password: PASSWORD }),
      registry.createVault({ vaultName: 'race', password: PASSWORD }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await registry.listRecords()).toHaveLength(1);
  }, 40000);

  it.each([
    ['', 'VAULT_NAME_INVALID'],
    [' leading', 'VAULT_NAME_INVALID'],
    ['a'.repeat(65), 'VAULT_NAME_INVALID'],
  ])('rejects invalid alias %s before storage', async (name, code) => {
    await expect(registry.createVault({ vaultName: name, password: PASSWORD })).rejects.toMatchObject({ code });
    expect(await registry.listRecords()).toEqual([]);
  });

  it.each(['short', 'correct horse battery staple'])('rejects weak password %s', async (password) => {
    await expect(registry.createVault({ vaultName: 'Weak', password })).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_WEAK',
    });
    expect(await registry.listRecords()).toEqual([]);
  });

  it('renames atomically, follows settings and preserves accounts and counters', async () => {
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Rename Me', { revision: 4, lockEpoch: 2 }));
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Other'));
    await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'rename me' });
    const before = await registry.getRecord('Rename Me');
    const renamed = await registry.renameVault('Rename Me', 'Renamed');
    expect(renamed.accounts).toEqual(before?.accounts);
    expect(renamed).toMatchObject({ revision: 4, lockEpoch: 2, vaultName: 'Renamed' });
    expect((await registry.getSettings()).activeVaultName).toBe('Renamed');
    await expect(registry.renameVault('Renamed', 'other')).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
    await expect(registry.renameVault('ghost', 'New')).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
  });

  it('aborts a rename when settings are corrupt after the vault writes', async () => {
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Rename Me'));
    fake.seed(VAULT_DB_NAME, VAULT_STORE_SETTINGS, { schemaVersion: 9 }, 'settings');
    const aborts = fake.abortCount();
    await expect(registry.renameVault('Rename Me', 'Renamed')).rejects.toMatchObject({
      code: 'VAULT_PAYLOAD_INVALID',
    });
    expect(fake.abortCount() - aborts).toBe(1);
  });

  it('removes records and clears only a dangling active pointer', async () => {
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Doomed'));
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Kept'));
    await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'Doomed' });
    await registry.removeVault('Doomed');
    expect(await registry.getRecord('Doomed')).toBeNull();
    expect((await registry.getSettings()).activeVaultName).toBeNull();
    await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'Kept' });
    await expect(registry.removeVault('missing')).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    expect((await registry.getSettings()).activeVaultName).toBe('Kept');
  });

  it('reads defaults, persists settings and rejects malformed settings', async () => {
    expect(await registry.getSettings()).toEqual({
      schemaVersion: 1,
      signingMode: 'privateKey',
      activeVaultName: null,
    });
    await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'Work' });
    expect((await registry.getSettings()).signingMode).toBe('vault');
    await expect(
      registry.putSettings({ schemaVersion: 1, signingMode: 'bad' as 'vault', activeVaultName: null }),
    ).rejects.toBeInstanceOf(TypeError);
    fake.seed(VAULT_DB_NAME, VAULT_STORE_SETTINGS, { schemaVersion: 2 }, 'settings');
    await expect(registry.getSettings()).rejects.toMatchObject({ code: 'VAULT_PAYLOAD_INVALID' });
  });

  describe('CAS and lock epoch', () => {
    async function seed(): Promise<VaultRecordV1> {
      const record = makeRecord('Cas', { revision: 3, lockEpoch: 5 });
      fake.seed(VAULT_DB_NAME, 'vaults', record);
      return record;
    }

    it('writes revision+1 only when createdAt, revision and lockEpoch all match', async () => {
      const current = await seed();
      const next: VaultRecordV1 = { ...current, revision: 4, accounts: [], updatedAt: Date.now() };
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: current.createdAt, revision: 3, lockEpoch: 5 },
          next,
        ),
      ).resolves.toEqual(next);
      expect(await registry.getRecord('Cas')).toEqual(next);
    });

    it('rejects a stale revision without changing either writer\'s data', async () => {
      const current = await seed();
      const next = { ...current, revision: 4, accounts: [] };
      const pointer = { vaultName: 'Cas', createdAt: current.createdAt, revision: 3, lockEpoch: 5 };
      await registry.swapRecord(pointer, next);
      await expect(
        registry.swapRecord(pointer, { ...current, revision: 4, accounts: v.envelope.accounts }),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      expect(await registry.getRecord('Cas')).toEqual(next);
    });

    it('rejects lockEpoch drift and same-name recreation with matching counters', async () => {
      const current = await seed();
      await registry.bumpLockEpoch('Cas');
      await expect(
        registry.swapRecord(
          { vaultName: 'Cas', createdAt: current.createdAt, revision: 3, lockEpoch: 5 },
          { ...current, revision: 4 },
        ),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      const first = makeRecord('Recreate');
      fake.seed(VAULT_DB_NAME, 'vaults', first);
      await registry.removeVault('Recreate');
      const recreated = makeRecord('Recreate');
      fake.seed(VAULT_DB_NAME, 'vaults', recreated);
      await expect(
        registry.swapRecord(
          { vaultName: 'Recreate', createdAt: first.createdAt, revision: 0, lockEpoch: 0 },
          { ...first, revision: 1 },
        ),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      expect(await registry.getRecord('Recreate')).toEqual(recreated);
    });

    it('validates programmer contracts, missing rows and the next envelope before writes', async () => {
      const current = await seed();
      const pointer = { vaultName: 'Cas', createdAt: current.createdAt, revision: 3, lockEpoch: 5 };
      await expect(
        registry.swapRecord(pointer, { ...current, vaultName: 'Other', revision: 4 }),
      ).rejects.toBeInstanceOf(TypeError);
      await expect(registry.swapRecord(pointer, { ...current, revision: 5 })).rejects.toBeInstanceOf(TypeError);
      await expect(registry.swapRecord(pointer, { ...current, revision: 4, lockEpoch: 6 })).rejects.toBeInstanceOf(TypeError);
      await expect(
        registry.swapRecord(pointer, { ...current, revision: 4, accounts: [{}] as VaultRecordV1['accounts'] }),
      ).rejects.toMatchObject({ code: 'VAULT_ENVELOPE_INVALID' });
      await expect(
        registry.swapRecord(
          { vaultName: 'ghost', createdAt: 1, revision: 0, lockEpoch: 0 },
          makeRecord('ghost', { revision: 1 }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
    });

    it('bumps lockEpoch without changing revision or encrypted accounts', async () => {
      const current = await seed();
      const bumped = await registry.bumpLockEpoch('Cas');
      expect(bumped).toMatchObject({ revision: 3, lockEpoch: 6, accounts: current.accounts });
    });
  });

  it('fails closed on corrupt stored envelopes or missing runtime fields', async () => {
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Broken', { accounts: [{}] as VaultRecordV1['accounts'] }));
    await expect(registry.getRecord('Broken')).rejects.toMatchObject({ code: 'VAULT_ENVELOPE_INVALID' });
    fake.seed(VAULT_DB_NAME, 'vaults', { ...v.envelope, vaultName: 'Half' });
    await expect(registry.getRecord('Half')).rejects.toMatchObject({ code: 'VAULT_ENVELOPE_INVALID' });
  });

  it('fails closed after close', async () => {
    registry.close();
    await expect(registry.listRecords()).rejects.toMatchObject({ code: 'VAULT_STORAGE_UNAVAILABLE' });
    expect(() => registry.close()).not.toThrow();
  });
});

describe('vault registry storage availability', () => {
  let fake: FakeIndexedDBHandle;
  afterEach(() => {
    fake.uninstall();
    fake.reset();
  });

  it('has no in-memory fallback when IndexedDB is missing or open fails', async () => {
    fake = installFakeIndexedDB();
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
    await expect(openVaultRegistry()).rejects.toBeInstanceOf(VaultError);
    await expect(openVaultRegistry()).rejects.toMatchObject({ code: 'VAULT_STORAGE_UNAVAILABLE' });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: { open: () => { throw new Error('boom'); } },
      configurable: true,
    });
    await expect(openVaultRegistry()).rejects.toMatchObject({ code: 'VAULT_STORAGE_UNAVAILABLE' });
  });
});
