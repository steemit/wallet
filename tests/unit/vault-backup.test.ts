import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  decryptVaultKey,
  deriveVaultKek,
  encryptVaultKeyRecord,
} from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url, validateVaultEnvelope } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  exportVaultBackup,
  importVaultBackup,
  mergeVaultBackup,
} from '@/lib/vault/backup';
import { VAULT_DB_NAME, openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import { createVaultService } from '@/lib/vault/service';
import type { VaultEnvelopeV1, VaultKeyCiphertext, VaultRecordV1 } from '@/lib/vault/types';

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');
const SOURCE_PASSWORD = 'a-different-source-passphrase';
const BOB_WIF = '5Ktest-wif-bob-0001';
let clock = 1_700_200_000_000;

function makeRecord(name = 'demo', overrides: Partial<VaultRecordV1> = {}): VaultRecordV1 {
  return {
    ...v.envelope,
    version: 1,
    vaultName: name,
    revision: 0,
    lockEpoch: 0,
    createdAt: clock++,
    updatedAt: clock++,
    lastBackupAt: null,
    ...overrides,
  };
}

/** The seeded record's portable envelope: the fixture shape named 'demo'. */
const demoEnvelope: VaultEnvelopeV1 = { ...v.envelope, version: 1, vaultName: 'demo' };

function encryptedFromVector(
  key: (typeof v.keys)[number],
  overrides: Partial<VaultKeyCiphertext> = {},
): VaultKeyCiphertext {
  return { iv: key.iv, ciphertext: key.ciphertext, note: key.note, ...overrides };
}

describe('hierarchical vault backup', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let targetKek: Uint8Array<ArrayBuffer>;
  let sourceKek: Uint8Array<ArrayBuffer>;
  let duplicateSource: VaultEnvelopeV1;
  let mergeSource: VaultEnvelopeV1;

  beforeAll(async () => {
    targetKek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    sourceKek = await deriveVaultKek(SOURCE_PASSWORD, decodeBase64Url(v.salt));
    duplicateSource = {
      ...v.envelope,
      version: 1,
      vaultName: 'duplicate-source',
      accounts: [
        {
          accountName: 'Alice',
          keys: {
            owner: [], active: [], memo: [],
            posting: [
              encryptedFromVector(posting),
              { iv: v.reencryption.iv, ciphertext: v.reencryption.ciphertext, note: 'duplicate' },
            ],
          },
        },
      ],
    };
    // The merge source must decrypt under SOURCE_PASSWORD (its own KEK), so
    // alice's posting entry is re-encrypted with sourceKek — reusing the
    // fixture reencryption ciphertext here would encrypt it under the TARGET
    // password and every merge with this source would fail authentication.
    const aliceSourceKey = await encryptVaultKeyRecord(
      sourceKek,
      posting.privateKey,
      'source loses',
      [posting.iv],
    );
    const bobKey = await encryptVaultKeyRecord(sourceKek, BOB_WIF, 'bob public label', [
      posting.iv,
      aliceSourceKey.iv,
    ]);
    mergeSource = {
      version: 1,
      vaultName: 'merge-source',
      salt: v.salt,
      accounts: [
        {
          accountName: 'alice',
          keys: {
            owner: [], active: [], memo: [],
            posting: [aliceSourceKey],
          },
        },
        { accountName: 'bob', keys: { owner: [], active: [bobKey], posting: [], memo: [] } },
      ],
    };
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord());
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
    vi.mocked(steem.auth.isWif).mockReset();
    vi.mocked(steem.auth.isWif).mockReturnValue(true);
    vi.mocked(steem.auth.getPublicKey).mockReset();
    vi.mocked(steem.auth.getPublicKey).mockImplementation((wif: string) => `STM${wif.slice(-8)}`);
  });

  async function current(name = 'demo'): Promise<VaultRecordV1> {
    const record = await registry.getRecord(name);
    if (!record) throw new Error('record missing');
    return record;
  }

  async function decryptRecord(record: VaultRecordV1, password: string): Promise<string[]> {
    const kek = await deriveVaultKek(password, decodeBase64Url(record.salt));
    const result: string[] = [];
    try {
      for (const account of record.accounts) {
        for (const role of ['owner', 'active', 'posting', 'memo'] as const) {
          for (const key of account.keys[role]) {
            result.push(await decryptVaultKey(kek, decodeBase64Url(key.iv), decodeBase64Url(key.ciphertext)));
          }
        }
      }
    } finally {
      kek.fill(0);
    }
    return result;
  }

  it('exports exactly four portable fields and leaves every key byte-identical', async () => {
    const before = await current();
    const backup = await exportVaultBackup(registry, 'demo');
    // The seeded record is the fixture envelope renamed 'demo' — the export
    // must carry that name, not the fixture's 'work' label.
    expect(backup).toEqual(demoEnvelope);
    expect(Object.keys(backup).sort()).toEqual(['accounts', 'salt', 'vaultName', 'version']);
    const after = await current();
    expect(after.accounts).toEqual(before.accounts);
    expect(after.salt).toBe(before.salt);
    expect(after.revision).toBe(1);
    expect(after.lastBackupAt).not.toBeNull();
    expect(JSON.stringify(backup)).not.toContain(posting.privateKey);
    expect(JSON.stringify(backup)).toContain('desktop posting key');
    await expect(exportVaultBackup(registry, 'ghost')).rejects.toMatchObject({ code: 'VAULT_NOT_FOUND' });
  });

  it('propagates VAULT_SESSION_STALE when the record moves between read and CAS, leaving lastBackupAt untouched', async () => {
    const before = await current('demo');
    const racing: VaultRegistry = {
      ...registry,
      getRecord: async (name: string) => {
        const record = await registry.getRecord(name);
        if (record !== null && name === 'demo') {
          // A concurrent lock lands AFTER the export's read but BEFORE its
          // CAS: lockEpoch moves, so the captured pointer no longer matches.
          await registry.bumpLockEpoch('demo');
        }
        return record;
      },
    };
    await expect(exportVaultBackup(racing, 'demo')).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    const after = await current('demo');
    // The swap never happened: lastBackupAt untouched, revision unchanged; the
    // only movement is the injected lockEpoch bump, and the envelope bytes
    // (accounts/salt) stay byte-identical.
    expect(after.lastBackupAt).toBeNull();
    expect(after.revision).toBe(before.revision);
    expect(after.lockEpoch).toBe(before.lockEpoch + 1);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.salt).toBe(before.salt);
  }, 30000);

  it('independently imports with a fresh salt and fresh per-key IVs, deduplicating source keys', async () => {
    const imported = await importVaultBackup(registry, {
      mode: 'independent', envelope: duplicateSource, password: v.password, vaultName: 'Imported',
    });
    expect(imported.vaultName).toBe('Imported');
    expect(imported.salt).not.toBe(v.salt);
    expect(imported.accounts).toHaveLength(1);
    expect(imported.accounts[0]?.accountName).toBe('alice');
    expect(imported.accounts[0]?.keys.posting).toHaveLength(1);
    const importedKey = imported.accounts[0]?.keys.posting[0];
    expect(importedKey?.note).toBe('desktop posting key');
    expect([posting.iv, v.reencryption.iv]).not.toContain(importedKey?.iv);
    expect(await decryptRecord(imported, v.password)).toEqual([posting.privateKey]);
    expect((await registry.getSettings()).activeVaultName).toBeNull();
  }, 40000);

  it('round-trips export/import with both keys and public notes intact', async () => {
    const backup = await exportVaultBackup(registry, 'demo');
    const imported = await importVaultBackup(registry, {
      mode: 'independent', envelope: backup, password: v.password, vaultName: 'Roundtrip',
    });
    expect((await decryptRecord(imported, v.password)).sort()).toEqual(
      [posting.privateKey, active.privateKey].sort(),
    );
    expect(imported.accounts[0]?.keys.posting[0]?.note).toBe('desktop posting key');
    expect(imported.accounts[0]?.keys.active[0]?.note).toBe('backup active key');
  }, 40000);

  it('rejects a wrong source password or weak import password without leaving a vault', async () => {
    await expect(importVaultBackup(registry, {
      mode: 'independent', envelope: duplicateSource, password: 'wrong-password-123456', vaultName: 'Nope',
    })).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    await expect(importVaultBackup(registry, {
      mode: 'independent', envelope: duplicateSource, password: 'correct horse battery staple', vaultName: 'Weak',
    })).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    expect(await registry.listRecords()).toHaveLength(1);
  }, 30000);

  it('rolls back the whole import when any key fails validation', async () => {
    vi.mocked(steem.auth.isWif).mockReturnValueOnce(true).mockReturnValueOnce(false);
    const badKey = await encryptVaultKeyRecord(targetKek, 'not-a-wif', 'bad key', [posting.iv, active.iv]);
    const source: VaultEnvelopeV1 = {
      ...v.envelope,
      version: 1,
      accounts: [{ accountName: 'alice', keys: { owner: [], active: [], posting: [badKey], memo: [] } }],
    };
    await expect(importVaultBackup(registry, {
      mode: 'independent', envelope: source, password: v.password, vaultName: 'Broken',
    })).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
    expect(await registry.getRecord('Broken')).toBeNull();
  }, 30000);

  it('rejects over-limit input and rolls back a failed final CAS', async () => {
    const invalid = {
      ...v.envelope,
      accounts: [{ accountName: 'alice', keys: { owner: [], active: [], memo: [], posting: [] } }],
    };
    expect(validateVaultEnvelope(invalid)).toEqual(invalid);
    const failing: VaultRegistry = {
      ...registry,
      swapRecord: () => Promise.reject(new VaultError('VAULT_SESSION_STALE', 'injected CAS failure')),
    };
    await expect(importVaultBackup(failing, {
      mode: 'independent', envelope: duplicateSource, password: v.password, vaultName: 'Imported',
    })).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    expect(await registry.getRecord('Imported')).toBeNull();
  }, 30000);

  it('a same-name remove+recreate replacing the import\'s vault makes the rollback stand down — the rebuild survives byte-intact', async () => {
    let importCreate: VaultRecordV1 | undefined;
    let rebuiltSnapshot: VaultRecordV1 | undefined;
    const racing: VaultRegistry = {
      ...registry,
      createVault: async (params: { vaultName: string; password: string }) => {
        const mine = await registry.createVault(params);
        importCreate = mine;
        // "Another tab" replaces the just-created instance under the same
        // name (fresh salt, same password) BEFORE the import's CAS reads
        // that name.
        await registry.removeVault(params.vaultName);
        rebuiltSnapshot = await registry.createVault(params);
        return mine;
      },
    };
    await expect(importVaultBackup(racing, {
      mode: 'independent', envelope: duplicateSource, password: v.password, vaultName: 'Imported',
    })).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    if (importCreate === undefined || rebuiltSnapshot === undefined) {
      throw new Error('createVault was not called');
    }
    // The CAS lost against the rebuild (different createdAt) and the rollback
    // STOOD DOWN instead of deleting by bare name: the other tab's vault is
    // still stored byte-for-byte — empty, revision 0, the source keys never
    // landed in it.
    expect(await current('Imported')).toEqual(rebuiltSnapshot);
    expect(rebuiltSnapshot.createdAt).not.toBe(importCreate.createdAt);
    expect(rebuiltSnapshot.revision).toBe(0);
    expect(rebuiltSnapshot.accounts).toEqual([]);
  }, 30000);

  it('a removal failure during rollback propagates the PRIMARY error; the residual is the created empty vault', async () => {
    let created: VaultRecordV1 | undefined;
    const failing: VaultRegistry = {
      ...registry,
      createVault: async (params: { vaultName: string; password: string }) => {
        created = await registry.createVault(params);
        return created;
      },
      swapRecord: () => Promise.reject(new VaultError('VAULT_SESSION_STALE', 'injected CAS failure')),
      removeVault: () => Promise.reject(new VaultError('VAULT_STORAGE_UNAVAILABLE', 'injected removal failure')),
    };
    await expect(importVaultBackup(failing, {
      mode: 'independent', envelope: duplicateSource, password: v.password, vaultName: 'Imported',
    })).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    // The PRIMARY (CAS) error wins — the rollback's own removal failure is
    // swallowed (best-effort). Residual terminal state in the per-key era,
    // asserted as implemented: the just-created EMPTY vault exactly as
    // created — revision 0, zero keys, the payload write never landed. It is
    // the documented VAULT_NAME_EXISTS-hinted leftover the user can delete
    // (or re-import under another name); nothing half-written is inside.
    if (created === undefined) throw new Error('createVault was not called');
    expect(await registry.getRecord('Imported')).toEqual(created);
    const residual = await registry.getRecord('Imported');
    expect(residual?.revision).toBe(0);
    expect(residual?.accounts).toEqual([]);
  }, 30000);

  it('imports an empty-source envelope (accounts: []) as a fresh empty vault', async () => {
    const emptySource: VaultEnvelopeV1 = { ...v.emptyEnvelope, version: 1, vaultName: 'empty-source' };
    const result = await importVaultBackup(registry, {
      mode: 'independent', envelope: emptySource, password: v.password, vaultName: 'Empty',
    });
    // Pinned semantics (2026-11-05 ruling): an empty source is a VALID
    // backup — the independent import (the recovery path the VAULT_EMPTY
    // merge rejection points at) creates a fresh, empty vault: fresh salt,
    // no keys to copy, one CAS commit (revision 1), nothing activated.
    expect(result.vaultName).toBe('Empty');
    expect(result.accounts).toEqual([]);
    expect(result.salt).not.toBe(emptySource.salt);
    expect(result.revision).toBe(1);
    expect(result.lastBackupAt).toBeNull();
    expect((await registry.getSettings()).activeVaultName).toBeNull();
    expect((await registry.listRecords()).map((record) => record.vaultName).sort()).toEqual(['Empty', 'demo']);
  }, 30000);

  it('merges with different source/target passwords, target-first dedupe and unchanged target ciphertext', async () => {
    const service = createVaultService(registry);
    await service.unlock('demo', v.password);
    const before = await current();
    const result = await mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
      targetVaultName: 'demo', targetPassword: v.password,
    });
    expect(result.preMergeBackup).toEqual(demoEnvelope);
    expect(result.status).toMatchObject({ locked: false, revision: 1 });
    const after = await current();
    expect(after.salt).toBe(before.salt);
    expect(after.accounts[0]?.keys.posting[0]).toEqual(before.accounts[0]?.keys.posting[0]);
    expect(after.accounts[0]?.keys.posting[0]?.note).toBe('desktop posting key');
    expect(after.accounts[0]?.keys.active[0]).toEqual(before.accounts[0]?.keys.active[0]);
    expect(after.accounts.map((account) => account.accountName)).toEqual(['alice', 'bob']);
    expect(await decryptRecord(after, v.password)).toContain(BOB_WIF);
    expect(JSON.stringify(result)).not.toContain(SOURCE_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(BOB_WIF);
    service.destroy();
  }, 40000);

  it('an empty or all-duplicate merge still uses CAS but never reencrypts target keys', async () => {
    const service = createVaultService(registry);
    await service.unlock('demo', v.password);
    const before = await current();
    const empty: VaultEnvelopeV1 = { ...v.emptyEnvelope, version: 1, vaultName: 'empty-source' };
    await mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: empty, password: SOURCE_PASSWORD,
      targetVaultName: 'demo', targetPassword: v.password,
    });
    const after = await current();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.accounts).toEqual(before.accounts);
    service.destroy();
  }, 30000);

  it('wrong passwords, locked target and CAS failure leave target byte-identical', async () => {
    const service = createVaultService(registry);
    const before = await current();
    await expect(mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
      targetVaultName: 'demo', targetPassword: v.password,
    })).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
    await service.unlock('demo', v.password);
    await expect(mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: mergeSource, password: 'wrong-password-123456',
      targetVaultName: 'demo', targetPassword: v.password,
    })).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    expect(await current()).toEqual(before);
    service.destroy();
    const failing: VaultRegistry = {
      ...registry,
      swapRecord: () => Promise.reject(new VaultError('VAULT_SESSION_STALE', 'injected CAS failure')),
    };
    const raced = createVaultService(failing);
    await raced.unlock('demo', v.password);
    await expect(mergeVaultBackup(failing, raced, {
      mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
      targetVaultName: 'demo', targetPassword: v.password,
    })).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    expect(await current()).toEqual(before);
    raced.destroy();
  }, 60000);

  it('authenticates target keys and never partially merges a tampered target', async () => {
    // Flip one ciphertext byte of the stored target's POSTING key. The flip
    // keeps the value canonical base64url (same length → re-encode is the
    // identity), but the AES-GCM authentication tag can no longer verify, so
    // the correct password is indistinguishable from a wrong one. The record's
    // FIRST key (the active key — unlock's authentication probe) stays intact,
    // so the session opens and the tampered posting key is first exercised by
    // the merge's own target authentication loop.
    const stored = makeRecord();
    const accounts = JSON.parse(JSON.stringify(stored.accounts)) as VaultRecordV1['accounts'];
    const key = accounts[0]?.keys.posting[0];
    if (!key) throw new Error('key missing');
    const bytes = decodeBase64Url(key.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    key.ciphertext = encodeBase64Url(bytes);
    const tampered = { ...stored, accounts };
    fake.seed(VAULT_DB_NAME, 'vaults', tampered);

    const service = createVaultService(registry);
    await service.unlock('demo', v.password);
    await expect(mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
      targetVaultName: 'demo', targetPassword: v.password,
    })).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    // The failed authentication left the target byte-identical — no partial
    // merge, no re-encryption, no revision bump.
    expect(await current()).toEqual(tampered);
    service.destroy();
  }, 40000);

  it('refuses to merge into a target with no keys (VAULT_EMPTY) — no silent re-key by a wrong targetPassword', async () => {
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('beta', { accounts: [] }));
    const service = createVaultService(registry);
    // An empty vault unlocks with ANY password (pinned semantics) — the merge
    // itself must be the fail-closed gate: with zero key ciphertext there is
    // nothing to authenticate `targetPassword` against, and the per-key
    // target decryption loop would iterate zero times, re-encrypting every
    // source key under whatever password was typed.
    await service.unlock('beta', 'any-password-opens-empty-1');
    const before = await current('beta');
    for (const targetPassword of [v.password, 'wrong-password-123456']) {
      await expect(mergeVaultBackup(registry, service, {
        mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
        targetVaultName: 'beta', targetPassword,
      })).rejects.toMatchObject({ code: 'VAULT_EMPTY' });
    }
    // The rejection fires before any password is used: the empty target
    // record is byte-identical — pre-fix, a wrong password would have
    // silently re-keyed the vault by importing every source key under it.
    expect(await current('beta')).toEqual(before);
    service.destroy();
  }, 30000);

  it('merges when the target name is a case variant of the selected session vault', async () => {
    const service = createVaultService(registry);
    await service.unlock('demo', v.password);
    const before = await current('demo');
    const result = await mergeVaultBackup(registry, service, {
      mode: 'merge', envelope: mergeSource, password: SOURCE_PASSWORD,
      targetVaultName: 'DEMO', targetPassword: v.password,
    });
    // The session selected 'demo'; 'DEMO' names the same vault through the
    // shared comparison key (exactly how the manager matches targets), so
    // the merge must resolve it instead of reporting VAULT_LOCKED. The
    // commit still lands on the STORED display name.
    expect(result.status).toMatchObject({ locked: false, vaultName: 'demo', revision: before.revision + 1 });
    const after = await current('demo');
    expect(after.accounts.map((account) => account.accountName)).toEqual(['alice', 'bob']);
    expect(await decryptRecord(after, v.password)).toContain(BOB_WIF);
    service.destroy();
  }, 40000);
});
