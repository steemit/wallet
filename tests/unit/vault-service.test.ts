import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { decryptVaultKey, deriveVaultKek } from '@/lib/vault/crypto';
import { decodeBase64Url } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  VAULT_BROADCAST_CHANNEL,
  createVaultService,
} from '@/lib/vault/service';
import {
  VAULT_DB_NAME,
  openVaultRegistry,
  type VaultRegistry,
} from '@/lib/vault/registry';
import type { VaultKeyInput, VaultRecordV1 } from '@/lib/vault/types';

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');
const NEW_WIF = '5Ktest-wif-alice-memo';
let clock = 1_700_100_000_000;

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

const broadcastDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
function hideBroadcast(): void {
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
}
function restoreBroadcast(): void {
  if (broadcastDescriptor) Object.defineProperty(globalThis, 'BroadcastChannel', broadcastDescriptor);
}
const settleBroadcast = () => new Promise((resolve) => setTimeout(resolve, 25));

describe('per-key vault service', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let kek: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    kek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord());
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('empty', { accounts: [] }));
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
    restoreBroadcast();
  });

  async function current(name = 'demo'): Promise<VaultRecordV1> {
    const record = await registry.getRecord(name);
    if (!record) throw new Error('record missing');
    return record;
  }

  it('reads accounts, roles, key IVs and public notes while locked without decryption', async () => {
    const service = createVaultService(registry);
    expect((await service.getStatus()).locked).toBe(true);
    const accounts = await service.getAccounts('demo');
    expect(accounts).toEqual([
      {
        accountName: 'alice',
        keys: [
          { role: 'active', iv: active.iv, note: 'backup active key' },
          { role: 'posting', iv: posting.iv, note: 'desktop posting key' },
        ],
        balances: null,
      },
    ]);
    const serialized = JSON.stringify(accounts);
    expect(serialized).not.toContain(posting.privateKey);
    expect(serialized).not.toContain(active.privateKey);
    expect(serialized).not.toContain(posting.ciphertext);
    expect(serialized).not.toContain(v.password);
    expect(serialized).not.toContain(v.kekHex.slice(0, 32));
    service.destroy();
  });

  it('uses the active vault outer record without an unlock or accountNames sidecar', async () => {
    await registry.putSettings({ schemaVersion: 1, signingMode: 'vault', activeVaultName: 'demo' });
    const service = createVaultService(registry);
    await expect(service.getAccounts()).resolves.toMatchObject([{ accountName: 'alice' }]);
    await expect(service.getAccounts('empty')).resolves.toEqual([]);
    service.destroy();
  });

  it('authenticates one key on unlock, retains no plaintext and leaves all ciphertext unchanged', async () => {
    const service = createVaultService(registry);
    const before = await current();
    await expect(service.unlock('demo', v.password)).resolves.toEqual({
      locked: false,
      vaultName: 'demo',
      revision: 0,
      lockEpoch: 0,
    });
    expect(await current()).toEqual(before);
    await expect(service.unlock('demo', 'wrong-password-123456')).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    expect((await service.getStatus()).locked).toBe(true);
    expect((await current()).lockEpoch).toBe(1);
    service.destroy();
  }, 30000);

  it('adds one key with a fresh IV, preserves other ciphertext and scrubs sensitive input', async () => {
    const service = createVaultService(registry);
    const before = await current();
    const input: VaultKeyInput = {
      vaultName: 'demo',
      accountName: 'Alice',
      role: 'memo',
      privateKey: NEW_WIF,
      note: 'public device label',
      password: v.password,
    };
    const after = await service.addKey(input);
    expect(after.revision).toBe(1);
    expect(after.salt).toBe(before.salt);
    expect(after.accounts[0]?.keys.active).toEqual(before.accounts[0]?.keys.active);
    expect(after.accounts[0]?.keys.posting).toEqual(before.accounts[0]?.keys.posting);
    const added = after.accounts[0]?.keys.memo[0];
    expect(added?.note).toBe('public device label');
    expect(added && [posting.iv, active.iv]).not.toContain(added?.iv);
    expect(input.privateKey).toBe('');
    expect(input.password).toBe('');
    if (!added) throw new Error('new key missing');
    await expect(
      decryptVaultKey(kek, decodeBase64Url(added.iv), decodeBase64Url(added.ciphertext)),
    ).resolves.toBe(NEW_WIF);
    service.destroy();
  }, 30000);

  it('deduplicates an existing account/role/publicKey without a write', async () => {
    const service = createVaultService(registry);
    const before = await current();
    const result = await service.addKey({
      vaultName: 'demo',
      accountName: 'alice',
      role: 'posting',
      privateKey: posting.privateKey,
      note: 'ignored duplicate note',
      password: v.password,
    });
    expect(result).toEqual(before);
    service.destroy();
  }, 20000);

  it('wrong-password add and failed CAS leave the original record byte-identical', async () => {
    const service = createVaultService(registry);
    const before = await current();
    const wrongInput: VaultKeyInput = {
      vaultName: 'demo', accountName: 'alice', role: 'memo', privateKey: NEW_WIF,
      note: 'not secret', password: 'wrong-password-123456',
    };
    await expect(service.addKey(wrongInput)).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    expect(wrongInput.password).toBe('');
    expect(await current()).toEqual(before);
    const failing: VaultRegistry = {
      ...registry,
      swapRecord: () => Promise.reject(new VaultError('VAULT_SESSION_STALE', 'injected CAS failure')),
    };
    const raced = createVaultService(failing);
    await expect(raced.addKey({
      vaultName: 'demo', accountName: 'alice', role: 'memo', privateKey: NEW_WIF,
      note: 'not secret', password: v.password,
    })).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    expect(await current()).toEqual(before);
    service.destroy();
    raced.destroy();
  }, 40000);

  it('removes only the IV-selected key and updates notes without reencrypting other keys', async () => {
    const service = createVaultService(registry);
    const before = await current();
    const renamed = await service.updateKeyNote(
      { vaultName: 'demo', accountName: 'alice', role: 'posting', keyIv: posting.iv },
      'updated public note',
    );
    expect(renamed.accounts[0]?.keys.posting[0]?.ciphertext).toBe(posting.ciphertext);
    expect(renamed.accounts[0]?.keys.active).toEqual(before.accounts[0]?.keys.active);
    const after = await service.removeKey({
      vaultName: 'demo', accountName: 'alice', role: 'posting', keyIv: posting.iv,
    });
    expect(after.accounts[0]?.keys.posting).toEqual([]);
    expect(after.accounts[0]?.keys.active).toEqual(before.accounts[0]?.keys.active);
    await expect(service.removeKey({
      vaultName: 'demo', accountName: 'alice', role: 'posting', keyIv: posting.iv,
    })).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
    service.destroy();
  });

  it('keeps revision/lockEpoch as the cross-tab hard line without BroadcastChannel', async () => {
    hideBroadcast();
    const registryB = await openVaultRegistry();
    const tabA = createVaultService(registry);
    const tabB = createVaultService(registryB);
    await tabA.unlock('demo', v.password);
    await tabB.unlock('demo', v.password);
    await tabB.lock();
    await expect(tabA.getStatus()).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    await expect(tabA.getAccounts('demo')).resolves.toMatchObject([{ accountName: 'alice' }]);
    tabA.destroy();
    tabB.destroy();
    registryB.close();
  }, 30000);

  it('a concurrent mutation stales another session and cannot overwrite its revision', async () => {
    hideBroadcast();
    const registryB = await openVaultRegistry();
    const tabA = createVaultService(registry);
    const tabB = createVaultService(registryB);
    await tabA.unlock('demo', v.password);
    await tabB.unlock('demo', v.password);
    const stale = await registryB.getRecord('demo');
    if (!stale) throw new Error('record missing');
    await tabA.updateKeyNote(
      { vaultName: 'demo', accountName: 'alice', role: 'posting', keyIv: posting.iv },
      'winner',
    );
    await expect(tabB.commitAccounts(stale, stale.accounts)).rejects.toMatchObject({
      code: 'VAULT_SESSION_STALE',
    });
    expect((await current()).accounts[0]?.keys.posting[0]?.note).toBe('winner');
    tabA.destroy();
    tabB.destroy();
    registryB.close();
  }, 30000);

  it('BroadcastChannel accelerates lock invalidation but carries no sensitive payload', async () => {
    const tabA = createVaultService(registry);
    const tabB = createVaultService(registry);
    const listener = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
    const messages: unknown[] = [];
    listener.onmessage = (event: MessageEvent<unknown>) => messages.push(event.data);
    await tabA.unlock('demo', v.password);
    await tabB.unlock('demo', v.password);
    await tabB.lock();
    await settleBroadcast();
    expect((await tabA.getStatus()).locked).toBe(true);
    expect(JSON.stringify(messages)).not.toContain(v.password);
    expect(JSON.stringify(messages)).not.toContain(posting.privateKey);
    listener.close();
    tabA.destroy();
    tabB.destroy();
  }, 20000);

  it('rejects invalid management writes before CAS', async () => {
    const service = createVaultService(registry);
    const before = await current();
    await expect(service.commitAccounts(before, [{}] as VaultRecordV1['accounts'])).rejects.toMatchObject({
      code: 'VAULT_ENVELOPE_INVALID',
    });
    expect(await current()).toEqual(before);
    service.destroy();
  });
});
