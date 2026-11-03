// Vault unlock-session service tests (A2). Storage runs on the hand-written
// fake IndexedDB (tests/mocks/fake-indexeddb.ts — see its FIDELITY BOUNDARY
// header); vault records are seeded directly from the fixed test vectors, so
// unlocking 'demo'/'alpha'/'beta' decrypts real fixture ciphertexts under the
// fixture password.
//
// BroadcastChannel: unlike indexedDB, vitest jsdom DOES expose a working
// BroadcastChannel (Node's own implementation leaks into the environment —
// verified by probe, 2026-11-04: cross-instance delivery works, senders do
// not receive their own messages). The "no BroadcastChannel" cases therefore
// HIDE the global explicitly; the "acceleration" cases use the real thing.
//
// Performance: PBKDF2 600k costs ~0.9s per derivation. Every unlock attempt
// derives (success or wrong password). This file derives 13 times total: one
// shared KEK in beforeAll (for decrypt round-trip assertions) + 12 unlock
// attempts — do not add unlock calls without pruning others.
//
// WIF→public-key derivation runs through the shared validateVaultWif entry
// point, which under vitest is driven by tests/mocks/steem-js.ts (fake
// getPublicKey: 'STM' + last 8 chars) — branch coverage only, per the A1.1
// two-layer rule; real crypto evidence lives in tests/node/vault-wif-real-check.mjs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { decryptVaultText, deriveVaultKek } from '@/lib/vault/crypto';
import { decodeBase64Url, validateVaultPayloadText } from '@/lib/vault/envelope';
import {
  VAULT_BROADCAST_CHANNEL,
  createVaultService,
  type VaultService,
  type VaultServiceStatus,
} from '@/lib/vault/service';
import { openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import type { VaultKeyEntry, VaultRecordV1 } from '@/lib/vault/types';
import { vaultNameComparisonKey } from '@/lib/vault/validation';

const v = vectors.vault;

const fixtureKeys = validateVaultPayloadText(v.payloadText).keys;
const aliceEntry: VaultKeyEntry | undefined = fixtureKeys[0];
if (!aliceEntry) {
  throw new Error('fixture payload has no key entry');
}
const aliceWif = aliceEntry.privateKey;
// The mock getPublicKey derives 'STM' + last 8 characters of the WIF.
const alicePublicKey = `STM${aliceWif.slice(-8)}`;
const BOB_ENTRY: VaultKeyEntry = { accountName: 'bob', role: 'active', privateKey: '5Ktest-wif-bob-0001' };
const bobPublicKey = `STM${BOB_ENTRY.privateKey.slice(-8)}`;
// A second key for the SAME account — exercises getAccounts() grouping.
const ALICE_MEMO_ENTRY: VaultKeyEntry = {
  accountName: 'alice',
  role: 'memo',
  privateKey: '5Ktest-wif-alice-memo',
};
const aliceMemoPublicKey = `STM${ALICE_MEMO_ENTRY.privateKey.slice(-8)}`;

let fakeClock = 1_700_100_000_000;

function makeRecord(
  vaultName: string,
  envelope: { iv: string; ciphertext: string },
  overrides: Partial<VaultRecordV1> = {},
): VaultRecordV1 {
  return {
    version: 1,
    vaultName,
    salt: v.salt,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    revision: 0,
    lockEpoch: 0,
    createdAt: fakeClock++,
    updatedAt: fakeClock++,
    lastBackupAt: null,
    ...overrides,
  };
}

/** Walk every object key of a public value hunting for sensitive field names. */
function collectKeyNames(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyNames(item, acc);
    return acc;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      acc.push(key);
      collectKeyNames(inner, acc);
    }
  }
  return acc;
}

const waitBroadcast = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 25);
  });

const broadcastDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');

function hideBroadcastChannel(): void {
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

function restoreBroadcastChannel(): void {
  if (broadcastDescriptor) {
    Object.defineProperty(globalThis, 'BroadcastChannel', broadcastDescriptor);
  } else {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  }
}

describe('vault service (A2)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  // Shared fixture KEK (password + fixture salt), derived once — used only to
  // decrypt stored ciphertexts in assertions, never passed to the service.
  let sharedKek: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    sharedKek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    fake.seed('steem-wallet-vault', 'vaults', makeRecord('demo', { iv: v.iv, ciphertext: v.ciphertext }));
    fake.seed(
      'steem-wallet-vault',
      'vaults',
      makeRecord('alpha', { iv: v.reencryption.iv, ciphertext: v.reencryption.ciphertext }),
    );
    fake.seed(
      'steem-wallet-vault',
      'vaults',
      makeRecord('beta', { iv: v.emptyPayload.iv, ciphertext: v.emptyPayload.ciphertext }),
    );
    fake.seed('steem-wallet-vault', 'vaults', makeRecord('corrupt', { iv: v.iv, ciphertext: 'A'.repeat(20) }));
  }, 30000);

  afterAll(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
  });

  const currentRecord = async (name: string): Promise<VaultRecordV1> => {
    const record = await registry.getRecord(name);
    if (!record) {
      throw new Error(`record ${name} disappeared`);
    }
    return record;
  };

  describe('unlock/lock lifecycle (BroadcastChannel available)', () => {
    let service: VaultService;

    beforeAll(() => {
      service = createVaultService(registry);
    });
    afterAll(() => {
      service.destroy();
    });

    it('1. a fresh instance starts locked', async () => {
      await expect(service.getStatus()).resolves.toEqual({
        locked: true,
        vaultName: null,
        revision: null,
        lockEpoch: null,
      });
    });

    it('2. unlocking an unknown vault rejects with VAULT_NOT_FOUND (no derivation)', async () => {
      await expect(service.unlock('ghost', v.password)).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
      expect((await service.getStatus()).locked).toBe(true);
    });

    it('3. unlocking a vault with a corrupt stored envelope fails closed', async () => {
      await expect(service.unlock('corrupt', v.password)).rejects.toMatchObject({
        code: 'VAULT_ENVELOPE_INVALID',
      });
    });

    it('4. unlocks with the correct password without touching the stored envelope', async () => {
      const before = await currentRecord('demo');
      const status = await service.unlock('demo', v.password);
      expect(status).toEqual({
        locked: false,
        vaultName: 'demo',
        revision: before.revision,
        lockEpoch: before.lockEpoch,
      });
      // Pure unlock: salt/IV/ciphertext AND counters stay untouched.
      const after = await currentRecord('demo');
      expect(after.salt).toBe(before.salt);
      expect(after.iv).toBe(before.iv);
      expect(after.ciphertext).toBe(before.ciphertext);
      expect(after.revision).toBe(before.revision);
      expect(after.lockEpoch).toBe(before.lockEpoch);
    }, 20000);

    it('5. exposes public-derived accounts carrying no key material', async () => {
      const accounts = await service.getAccounts();
      expect(accounts).toEqual([
        {
          accountName: 'alice',
          keys: [{ accountName: 'alice', role: 'posting', publicKey: alicePublicKey }],
          balances: null,
        },
      ]);
      // Hard leak assertions: no WIF, no KEK fragment, no sensitive field names
      // anywhere in the exported value.
      const serialized = JSON.stringify(accounts);
      expect(serialized).not.toContain(aliceWif);
      expect(serialized).not.toContain(v.kekHex.slice(0, 32));
      expect(serialized).not.toContain(v.payloadText.slice(0, 24));
      const keyNames = collectKeyNames(accounts);
      expect(keyNames).not.toContain('privateKey');
      expect(keyNames).not.toContain('kek');
      expect(keyNames).not.toContain('payload');
    }, 20000);

    it('6. locks: session cleared, lockEpoch+1 persisted, envelope untouched, re-lock no-op', async () => {
      const before = await currentRecord('demo');
      await service.lock();
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true, vaultName: null });
      const after = await currentRecord('demo');
      expect(after.lockEpoch).toBe(before.lockEpoch + 1);
      expect(after.revision).toBe(before.revision);
      expect(after.salt).toBe(before.salt);
      expect(after.iv).toBe(before.iv);
      expect(after.ciphertext).toBe(before.ciphertext);
      // Session-bound operations now require an unlock.
      await expect(service.getAccounts()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      await expect(service.mutatePayload(() => undefined)).rejects.toMatchObject({
        code: 'VAULT_LOCKED',
      });
      // Locking again is a no-op (no double epoch bump).
      await service.lock();
      expect((await currentRecord('demo')).lockEpoch).toBe(before.lockEpoch + 1);
    }, 20000);

    it('7. KEK zeroization is observable as "must re-authenticate" (behavior assertion)', async () => {
      // No spy/injection hook into the service closure is allowed, so the
      // fill(0) cannot be observed directly. Behavioral contract instead:
      // after lock every session-bound op fails, and unlocking again NEEDS
      // the password — a retained KEK would be unusable anyway, and the wrong
      // password still derives a wrong KEK and fails authentication.
      await expect(service.getAccounts()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      await expect(service.unlock('demo', 'wrong-password-123456')).rejects.toMatchObject({
        code: 'VAULT_PASSWORD_INVALID',
      });
      expect((await service.getStatus()).locked).toBe(true);
    }, 20000);

    it('8. re-unlocks after a lock, adopting the CURRENT lockEpoch', async () => {
      const record = await currentRecord('demo');
      const status: VaultServiceStatus = await service.unlock('demo', v.password);
      expect(status).toEqual({
        locked: false,
        vaultName: 'demo',
        revision: record.revision,
        lockEpoch: record.lockEpoch,
      });
    }, 20000);

    it('9. mutatePayload rotates IV+ciphertext, bumps revision, keeps salt, round-trips', async () => {
      const before = await currentRecord('demo');
      const status = await service.mutatePayload((draft) => {
        draft.keys.push({ ...ALICE_MEMO_ENTRY }, { ...BOB_ENTRY });
      });
      expect(status.revision).toBe(before.revision + 1);
      const after = await currentRecord('demo');
      expect(after.iv).not.toBe(before.iv);
      expect(after.ciphertext).not.toBe(before.ciphertext);
      expect(after.salt).toBe(before.salt);
      expect(after.lockEpoch).toBe(before.lockEpoch);
      expect(after.revision).toBe(before.revision + 1);
      // The rewritten envelope decrypts under the (fixture) vault password…
      const payloadText = await decryptVaultText(
        sharedKek,
        decodeBase64Url(after.iv),
        decodeBase64Url(after.ciphertext),
      );
      // …to exactly the mutated payload.
      expect(payloadText).toBe(JSON.stringify({ keys: [aliceEntry, ALICE_MEMO_ENTRY, BOB_ENTRY] }));
      expect(validateVaultPayloadText(payloadText).keys).toHaveLength(3);
      // The session adopted the new payload and revision.
      await expect(service.getStatus()).resolves.toMatchObject({
        locked: false,
        revision: after.revision,
        vaultName: 'demo',
      });
      // Two keys of the SAME account group into one summary.
      const accounts = await service.getAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts[0]).toEqual({
        accountName: 'alice',
        keys: [
          { accountName: 'alice', role: 'posting', publicKey: alicePublicKey },
          { accountName: 'alice', role: 'memo', publicKey: aliceMemoPublicKey },
        ],
        balances: null,
      });
      expect(accounts[1]).toEqual({
        accountName: 'bob',
        keys: [{ accountName: 'bob', role: 'active', publicKey: bobPublicKey }],
        balances: null,
      });
    }, 20000);

    it('10. validation failure inside mutatePayload rolls back: nothing written, session intact', async () => {
      const before = await currentRecord('demo');
      // Structural violation → VAULT_PAYLOAD_INVALID.
      await expect(
        service.mutatePayload((draft) => {
          draft.keys.push({ accountName: 'x', role: 'bogus' as VaultKeyEntry['role'], privateKey: '5Kx' });
        }),
      ).rejects.toMatchObject({ code: 'VAULT_PAYLOAD_INVALID' });
      // Resource violation (401 keys) → VAULT_LIMIT_EXCEEDED.
      await expect(
        service.mutatePayload((draft) => {
          draft.keys = Array.from({ length: 401 }, (_, i) => ({
            accountName: `acct${i % 100}`,
            role: 'posting',
            privateKey: '5Kpad',
          }));
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      // Nothing was written by either attempt…
      const after = await currentRecord('demo');
      expect(after.revision).toBe(before.revision);
      expect(after.iv).toBe(before.iv);
      expect(after.ciphertext).toBe(before.ciphertext);
      // …and the session keeps its ORIGINAL payload, still unlocked (the
      // alice grouping from the previous case survives untouched).
      const accounts = await service.getAccounts();
      expect(accounts.map((a) => a.accountName)).toEqual(['alice', 'bob']);
      expect(accounts[0]?.keys).toHaveLength(2);
    }, 20000);

    it('11. a throwing mutator changes nothing', async () => {
      const before = await currentRecord('demo');
      await expect(
        service.mutatePayload(() => {
          throw new Error('mutator exploded');
        }),
      ).rejects.toThrow('mutator exploded');
      const after = await currentRecord('demo');
      expect(after).toEqual(before);
    });

    it('12. switching vaults clears the previous session COMPLETELY and persists its lock', async () => {
      await service.unlock('alpha', v.password);
      await expect(service.getStatus()).resolves.toMatchObject({ vaultName: 'alpha' });
      const demoEpochBefore = (await currentRecord('demo')).lockEpoch;
      // Switching to beta locks alpha first…
      const status = await service.unlock('beta', v.password);
      expect(status.vaultName).toBe('beta');
      expect((await currentRecord('alpha')).lockEpoch).toBe(1); // lock persisted
      expect((await currentRecord('demo')).lockEpoch).toBe(demoEpochBefore); // untouched
      // …beta is an empty-payload vault: zero accounts, still unlocked.
      await expect(service.getAccounts()).resolves.toEqual([]);
      await expect(service.getStatus()).resolves.toMatchObject({ locked: false, vaultName: 'beta' });
    }, 40000);

    it('13. a failed unlock after a switch still leaves the previous session cleared', async () => {
      const betaEpochBefore = (await currentRecord('beta')).lockEpoch;
      await expect(service.unlock('demo', 'wrong-password-123456')).rejects.toMatchObject({
        code: 'VAULT_PASSWORD_INVALID',
      });
      // beta was fully locked by the switch attempt even though the unlock failed.
      expect((await currentRecord('beta')).lockEpoch).toBe(betaEpochBefore + 1);
      expect((await service.getStatus()).locked).toBe(true);
    }, 20000);
  });

  describe('cross-instance invalidation without BroadcastChannel (hard line only)', () => {
    // NOTE: vitest jsdom actually HAS Node's BroadcastChannel — hide it to
    // prove the re-read hard line works with no acceleration at all.
    let tabA: VaultService;
    let tabB: VaultService;
    let registryA: VaultRegistry;
    let registryB: VaultRegistry;

    beforeAll(async () => {
      hideBroadcastChannel();
      registryA = await openVaultRegistry();
      registryB = await openVaultRegistry();
      tabA = createVaultService(registryA);
      tabB = createVaultService(registryB);
    });
    afterAll(() => {
      tabA.destroy();
      tabB.destroy();
      registryA.close();
      registryB.close();
      restoreBroadcastChannel();
    });

    it("a lock in tab B stales tab A's session on its next operation", async () => {
      await tabA.unlock('demo', v.password);
      await tabB.unlock('demo', v.password);
      const before = await registryA.getRecord('demo');
      await tabB.lock();
      // No broadcast exists here — the HARD LINE must catch it: tab A re-reads
      // the registry, sees the moved lockEpoch and rejects.
      await expect(tabA.getAccounts()).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      // Stale detection cleared tab A's memory: subsequent calls report locked.
      await expect(tabA.getStatus()).resolves.toMatchObject({ locked: true });
      const after = await registryA.getRecord('demo');
      expect(after?.lockEpoch).toBe((before?.lockEpoch ?? 0) + 1);
    }, 30000);

    it("a mutation in tab A stales tab B's session", async () => {
      // tab B locked itself in the previous case — unlock it again first.
      await tabB.unlock('demo', v.password);
      await tabA.unlock('demo', v.password);
      const revisionBefore = (await currentRecord('demo')).revision;
      await tabA.mutatePayload((draft) => {
        draft.keys.push({ ...BOB_ENTRY });
      });
      expect((await currentRecord('demo')).revision).toBe(revisionBefore + 1);
      await expect(tabB.getAccounts()).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
    }, 30000);

    it('a fresh service instance over the same storage starts locked (refresh simulation)', async () => {
      const refreshed = createVaultService(registryB);
      await expect(refreshed.getStatus()).resolves.toMatchObject({ locked: true });
      refreshed.destroy();
    });
  });

  describe('cross-instance acceleration via BroadcastChannel', () => {
    let tabA: VaultService;
    let tabB: VaultService;

    beforeAll(async () => {
      // BroadcastChannel visible (Node's real one, verified working in jsdom).
      tabA = createVaultService(registry);
      tabB = createVaultService(registry);
    });
    afterAll(() => {
      tabA.destroy();
      tabB.destroy();
    });

    it('a remote lock clears the local session BEFORE its next operation (no stale error)', async () => {
      await tabA.unlock('demo', v.password);
      await tabB.unlock('demo', v.password);
      await tabB.lock();
      await waitBroadcast();
      // The acceleration event fully cleared tab A: locked, not stale.
      await expect(tabA.getStatus()).resolves.toMatchObject({ locked: true, vaultName: null });
      await expect(tabA.getAccounts()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
    }, 30000);

    it('ignores malformed messages, other vaults, and messages with no session', async () => {
      // tab A is locked (cleared above) — messages must neither throw nor
      // resurrect a session.
      const manual = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
      manual.postMessage({ kind: 'vault-lock', key: vaultNameComparisonKey('demo') });
      manual.postMessage({ kind: 'vault-lock' }); // missing key
      manual.postMessage('not-an-object');
      manual.postMessage({ kind: 'bogus', key: 'demo' });
      manual.postMessage({ kind: 'vault-mutate', key: vaultNameComparisonKey('alpha') });
      await waitBroadcast();
      await expect(tabA.getStatus()).resolves.toMatchObject({ locked: true });
      manual.close();
    });
  });
});
