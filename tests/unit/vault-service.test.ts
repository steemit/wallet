// Vault unlock-session service tests (A2). Storage runs on the hand-written
// fake IndexedDB (tests/mocks/fake-indexeddb.ts — see its FIDELITY BOUNDARY
// header); vault records are seeded directly from the fixed test vectors, so
// unlocking 'demo'/'alpha'/'beta' decrypts real fixture ciphertexts under the
// fixture password.
//
// ORDER INDEPENDENCE: every test rebuilds its own fake database, registry and
// service instances in beforeEach and tears them down in afterEach — no test
// depends on state another test left behind. The file is therefore shuffle-
// and single-test safe (`vitest run --sequence.shuffle
// tests/unit/vault-service.test.ts`; verified across several seeds).
//
// BroadcastChannel: unlike indexedDB, vitest jsdom DOES expose a working
// BroadcastChannel (Node's own implementation leaks into the environment —
// verified by probe, 2026-11-04: cross-instance delivery works, senders do
// not receive their own messages). The "no BroadcastChannel" tests HIDE the
// global for their describe and restore it in afterEach; the "acceleration"
// tests use the real thing.
//
// Performance: PBKDF2 600k costs ~0.6s per derivation and every unlock derives.
// Two derivations are paid ONCE in beforeAll (the shared fixture KEK and the
// remove/recreate vault's different-password KEK); each test then pays only
// for the unlocks it itself performs (20 per full run). Do not add unlock
// calls without pruning others.
//
// WIF→public-key derivation runs through the shared validateVaultWif entry
// point, which under vitest is driven by tests/mocks/steem-js.ts (fake
// getPublicKey: 'STM' + last 8 chars) — branch coverage only, per the A1.1
// two-layer rule; real crypto evidence lives in tests/node/vault-wif-real-check.mjs.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  decryptVaultText,
  deriveVaultKek,
  encryptVaultText,
  generateVaultIv,
  generateVaultSalt,
} from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url, validateVaultPayloadText } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  VAULT_BROADCAST_CHANNEL,
  createVaultService,
  type VaultServiceStatus,
} from '@/lib/vault/service';
import {
  VAULT_DB_NAME,
  openVaultRegistry,
  type VaultRegistry,
  type VaultRevisionPointer,
} from '@/lib/vault/registry';
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

// Material for the "recreated vault" of the remove+recreate regression: a
// complete second envelope under a DIFFERENT password, derived/encrypted once
// in beforeAll so the test itself never pays PBKDF2 for it.
const RECREATED_PASSWORD = 'a-second-fine-long-vault-passphrase';
const EMPTY_PAYLOAD_TEXT = '{"keys":[]}';
let recreatedEnvelope: { salt: string; iv: string; ciphertext: string };
// KEK of the recreated vault — test-only decryption proof that the recreated
// envelope stays unlockable under the NEW password (not passed to services).
let recreatedKek: Uint8Array<ArrayBuffer>;

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
    sharedKek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    const salt = generateVaultSalt();
    recreatedKek = await deriveVaultKek(RECREATED_PASSWORD, salt);
    const iv = generateVaultIv();
    recreatedEnvelope = {
      salt: encodeBase64Url(salt),
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(await encryptVaultText(recreatedKek, iv, EMPTY_PAYLOAD_TEXT)),
    };
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo', { iv: v.iv, ciphertext: v.ciphertext }));
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('alpha', { iv: v.reencryption.iv, ciphertext: v.reencryption.ciphertext }),
    );
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('beta', { iv: v.emptyPayload.iv, ciphertext: v.emptyPayload.ciphertext }),
    );
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('corrupt', { iv: v.iv, ciphertext: 'A'.repeat(20) }));
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
    restoreBroadcastChannel();
  });

  const currentRecord = async (name: string): Promise<VaultRecordV1> => {
    const record = await registry.getRecord(name);
    if (!record) {
      throw new Error(`record ${name} disappeared`);
    }
    return record;
  };

  describe('unlock/lock lifecycle', () => {
    it('starts locked; unknown vaults and corrupt envelopes fail closed before any crypto', async () => {
      const service = createVaultService(registry);
      await expect(service.getStatus()).resolves.toEqual({
        locked: true,
        vaultName: null,
        revision: null,
        lockEpoch: null,
      });
      await expect(service.unlock('ghost', v.password)).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
      await expect(service.unlock('corrupt', v.password)).rejects.toMatchObject({
        code: 'VAULT_ENVELOPE_INVALID',
      });
      // A second instance over the same storage also starts locked (refresh
      // simulation).
      const refreshed = createVaultService(registry);
      await expect(refreshed.getStatus()).resolves.toMatchObject({ locked: true });
      service.destroy();
      refreshed.destroy();
    });

    it('unlocks without touching the stored envelope and exposes only public-derived accounts', async () => {
      const service = createVaultService(registry);
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
      expect(after).toEqual(before);
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
      service.destroy();
    }, 20000);

    it('mutatePayload rotates IV+ciphertext, bumps revision, round-trips; failures roll back fully', async () => {
      const service = createVaultService(registry);
      await service.unlock('demo', v.password);
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
      // The session adopted the new payload and revision.
      await expect(service.getStatus()).resolves.toMatchObject({
        locked: false,
        revision: after.revision,
        vaultName: 'demo',
      });
      // Two keys of the SAME account group into one summary.
      const accounts = await service.getAccounts();
      expect(accounts).toEqual([
        {
          accountName: 'alice',
          keys: [
            { accountName: 'alice', role: 'posting', publicKey: alicePublicKey },
            { accountName: 'alice', role: 'memo', publicKey: aliceMemoPublicKey },
          ],
          balances: null,
        },
        {
          accountName: 'bob',
          keys: [{ accountName: 'bob', role: 'active', publicKey: bobPublicKey }],
          balances: null,
        },
      ]);
      // Rollback 1 — structural violation → VAULT_PAYLOAD_INVALID.
      await expect(
        service.mutatePayload((draft) => {
          draft.keys.push({ accountName: 'x', role: 'bogus' as VaultKeyEntry['role'], privateKey: '5Kx' });
        }),
      ).rejects.toMatchObject({ code: 'VAULT_PAYLOAD_INVALID' });
      // Rollback 2 — resource violation (401 keys) → VAULT_LIMIT_EXCEEDED.
      await expect(
        service.mutatePayload((draft) => {
          draft.keys = Array.from({ length: 401 }, (_, i) => ({
            accountName: `acct${i % 100}`,
            role: 'posting',
            privateKey: '5Kpad',
          }));
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      // Rollback 3 — a throwing mutator changes nothing.
      await expect(
        service.mutatePayload(() => {
          throw new Error('mutator exploded');
        }),
      ).rejects.toThrow('mutator exploded');
      // Nothing was written by any failed attempt…
      const final = await currentRecord('demo');
      expect(final.revision).toBe(after.revision);
      expect(final.iv).toBe(after.iv);
      expect(final.ciphertext).toBe(after.ciphertext);
      // …and the session keeps its ORIGINAL payload, still unlocked.
      const accountsAfter = await service.getAccounts();
      expect(accountsAfter.map((a) => a.accountName)).toEqual(['alice', 'bob']);
      expect(accountsAfter[0]?.keys).toHaveLength(2);
      service.destroy();
    }, 30000);

    it('lock clears memory and bumps lockEpoch; wrong passwords fail closed; re-unlock adopts the CURRENT epoch', async () => {
      const service = createVaultService(registry);
      const before = await currentRecord('demo');
      await service.unlock('demo', v.password);
      await service.lock();
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true, vaultName: null });
      const afterLock = await currentRecord('demo');
      expect(afterLock.lockEpoch).toBe(before.lockEpoch + 1);
      expect(afterLock.revision).toBe(before.revision);
      expect(afterLock.salt).toBe(before.salt);
      expect(afterLock.iv).toBe(before.iv);
      expect(afterLock.ciphertext).toBe(before.ciphertext);
      // Session-bound operations now require an unlock.
      await expect(service.getAccounts()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      await expect(service.mutatePayload(() => undefined)).rejects.toMatchObject({
        code: 'VAULT_LOCKED',
      });
      // Locking again is a no-op (no double epoch bump).
      await service.lock();
      expect((await currentRecord('demo')).lockEpoch).toBe(before.lockEpoch + 1);
      // A wrong password still derives a wrong KEK and fails authentication —
      // a retained KEK would be unusable anyway (zeroization behavior check).
      await expect(service.unlock('demo', 'wrong-password-123456')).rejects.toMatchObject({
        code: 'VAULT_PASSWORD_INVALID',
      });
      expect((await service.getStatus()).locked).toBe(true);
      // Re-unlock adopts the CURRENT lockEpoch, not the pre-lock one.
      const record = await currentRecord('demo');
      const status: VaultServiceStatus = await service.unlock('demo', v.password);
      expect(status).toEqual({
        locked: false,
        vaultName: 'demo',
        revision: record.revision,
        lockEpoch: record.lockEpoch,
      });
      service.destroy();
    }, 40000);

    it('switching vaults locks the previous one for good — even when the new unlock fails', async () => {
      const service = createVaultService(registry);
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
      // A FAILED unlock after the switch still leaves the previous session
      // cleared — beta was fully locked by the switch attempt.
      const betaEpochBefore = (await currentRecord('beta')).lockEpoch;
      await expect(service.unlock('demo', 'wrong-password-123456')).rejects.toMatchObject({
        code: 'VAULT_PASSWORD_INVALID',
      });
      expect((await currentRecord('beta')).lockEpoch).toBe(betaEpochBefore + 1);
      expect((await service.getStatus()).locked).toBe(true);
      service.destroy();
    }, 40000);
  });

  describe('cross-instance invalidation without BroadcastChannel (hard line only)', () => {
    // NOTE: vitest jsdom actually HAS Node's BroadcastChannel — hide it to
    // prove the re-read hard line works with no acceleration at all.
    beforeEach(() => {
      hideBroadcastChannel();
    });
    afterEach(() => {
      restoreBroadcastChannel();
    });

    it("a lock in tab B stales tab A's session on its next operation", async () => {
      const registryB = await openVaultRegistry();
      const tabA = createVaultService(registry);
      const tabB = createVaultService(registryB);
      await tabA.unlock('demo', v.password);
      await tabB.unlock('demo', v.password);
      const before = await registry.getRecord('demo');
      await tabB.lock();
      // No broadcast exists here — the HARD LINE must catch it: tab A re-reads
      // the registry, sees the moved lockEpoch and rejects.
      await expect(tabA.getAccounts()).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      // Stale detection cleared tab A's memory: subsequent calls report locked.
      await expect(tabA.getStatus()).resolves.toMatchObject({ locked: true });
      const after = await registry.getRecord('demo');
      expect(after?.lockEpoch).toBe((before?.lockEpoch ?? 0) + 1);
      tabA.destroy();
      tabB.destroy();
      registryB.close();
    }, 30000);

    it("a mutation in tab A stales tab B's session", async () => {
      const registryB = await openVaultRegistry();
      const tabA = createVaultService(registry);
      const tabB = createVaultService(registryB);
      await tabA.unlock('demo', v.password);
      await tabB.unlock('demo', v.password);
      const revisionBefore = (await currentRecord('demo')).revision;
      await tabA.mutatePayload((draft) => {
        draft.keys.push({ ...BOB_ENTRY });
      });
      expect((await currentRecord('demo')).revision).toBe(revisionBefore + 1);
      await expect(tabB.getAccounts()).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      tabA.destroy();
      tabB.destroy();
      registryB.close();
    }, 30000);
  });

  describe('cross-instance acceleration via BroadcastChannel', () => {
    it('a remote lock clears the local session BEFORE its next operation (no stale error)', async () => {
      const tabA = createVaultService(registry);
      const tabB = createVaultService(registry);
      await tabA.unlock('demo', v.password);
      await tabB.unlock('demo', v.password);
      await tabB.lock();
      await waitBroadcast();
      // The acceleration event fully cleared tab A: locked, not stale.
      await expect(tabA.getStatus()).resolves.toMatchObject({ locked: true, vaultName: null });
      await expect(tabA.getAccounts()).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      tabA.destroy();
      tabB.destroy();
    }, 30000);

    it('ignores malformed messages and messages with no session', async () => {
      // Never unlocked — messages must neither throw nor resurrect a session.
      const service = createVaultService(registry);
      const manual = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
      manual.postMessage({ kind: 'vault-lock', key: vaultNameComparisonKey('demo') });
      manual.postMessage({ kind: 'vault-lock' }); // missing key
      manual.postMessage('not-an-object');
      manual.postMessage({ kind: 'bogus', key: 'demo' });
      manual.postMessage({ kind: 'vault-mutate', key: vaultNameComparisonKey('alpha') });
      await waitBroadcast();
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true });
      manual.close();
      service.destroy();
    });
  });

  describe('three-party review regressions (2026-11)', () => {
    it('[P1] a remove+recreate under the same name cannot adopt the old session or pollute the new vault', async () => {
      const original = await currentRecord('demo');
      const tabB = createVaultService(registry);
      await tabB.unlock('demo', v.password); // session bound to the ORIGINAL record
      // Tab A removes 'demo' and recreates it under the SAME name with a
      // fresh salt and a DIFFERENT password (counters restart at 0/0).
      await registry.removeVault('demo');
      const recreated = makeRecord(
        'demo',
        { iv: recreatedEnvelope.iv, ciphertext: recreatedEnvelope.ciphertext },
        { salt: recreatedEnvelope.salt },
      );
      fake.seed(VAULT_DB_NAME, 'vaults', recreated);
      expect(recreated.createdAt).not.toBe(original.createdAt); // distinct record instance (sanity)
      expect(recreated.salt).not.toBe(original.salt); // the old KEK cannot decrypt the new vault
      // The stale session is detected on its next operation…
      await expect(
        tabB.mutatePayload((draft) => {
          draft.keys.push({ ...BOB_ENTRY });
        }),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      await expect(tabB.getStatus()).resolves.toMatchObject({ locked: true });
      // …and the recreated vault is untouched: byte-identical envelope…
      const stored = await currentRecord('demo');
      expect(stored.ciphertext).toBe(recreatedEnvelope.ciphertext);
      expect(stored.iv).toBe(recreatedEnvelope.iv);
      expect(stored.salt).toBe(recreatedEnvelope.salt);
      expect(stored.revision).toBe(0);
      // …that still decrypts under the NEW password's KEK…
      await expect(
        decryptVaultText(recreatedKek, decodeBase64Url(stored.iv), decodeBase64Url(stored.ciphertext)),
      ).resolves.toBe(EMPTY_PAYLOAD_TEXT);
      // …and actually unlocks with the new password.
      const fresh = createVaultService(registry);
      await expect(fresh.unlock('demo', RECREATED_PASSWORD)).resolves.toMatchObject({
        locked: false,
        vaultName: 'demo',
      });
      await expect(fresh.getAccounts()).resolves.toEqual([]);
      fresh.destroy();
      tabB.destroy();
    }, 30000);

    it('[P2] the CAS adopt branch uses the live session KEK, never the await-time snapshot', async () => {
      // Gate swapRecord so the CAS is provably in flight while the session is
      // destroyed and re-unlocked with the SAME password (every counter and
      // the createdAt match — only the KEK bytes differ: the snapshot's were
      // zeroized by the destroy).
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const gated: VaultRegistry = {
        ...registry,
        swapRecord: (expected: VaultRevisionPointer, next: VaultRecordV1) =>
          gate.then(() => registry.swapRecord(expected, next)),
      };
      const service = createVaultService(gated);
      await service.unlock('demo', v.password);
      const pending = service.mutatePayload((draft) => {
        draft.keys.push({ ...ALICE_MEMO_ENTRY });
      });
      // Let the mutation pass its freshness check and park at the gated CAS.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      service.destroy(); // KEK zeroized, session dropped, channel closed
      await service.unlock('demo', v.password); // same password → same identity, FRESH KEK
      release();
      const status = await pending; // the CAS itself still succeeds
      expect(status).toMatchObject({ locked: false, vaultName: 'demo', revision: 1 });
      // The adopted KEK must be the LIVE one: later mutations still encrypt
      // under a key that decrypts with the fixture password. (With the bug,
      // the adopted zero-key would make this decrypt — and the vault — fail.)
      await expect(service.getStatus()).resolves.toMatchObject({
        locked: false,
        vaultName: 'demo',
        revision: 1,
      });
      const second = await service.mutatePayload((draft) => {
        draft.keys.push({ ...BOB_ENTRY });
      });
      expect(second.revision).toBe(2);
      const stored = await currentRecord('demo');
      expect(stored.revision).toBe(2);
      const payloadText = await decryptVaultText(
        sharedKek,
        decodeBase64Url(stored.iv),
        decodeBase64Url(stored.ciphertext),
      );
      expect(payloadText).toBe(JSON.stringify({ keys: [aliceEntry, ALICE_MEMO_ENTRY, BOB_ENTRY] }));
      service.destroy();
    }, 30000);

    it('[P2] lock() still broadcasts the acceleration event when the epoch bump fails', async () => {
      const failing: VaultRegistry = {
        ...registry,
        bumpLockEpoch: () =>
          Promise.reject(new VaultError('VAULT_STORAGE_UNAVAILABLE', 'injected bump failure')),
      };
      const service = createVaultService(failing);
      const seen: Array<{ kind?: string; key?: string }> = [];
      const listener = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
      listener.onmessage = (event: MessageEvent<{ kind?: string; key?: string }>) => {
        seen.push(event.data);
      };
      await service.unlock('demo', v.password);
      await expect(service.lock()).rejects.toMatchObject({ code: 'VAULT_STORAGE_UNAVAILABLE' });
      await waitBroadcast();
      // Local memory was cleared despite the persistence failure…
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true, vaultName: null });
      // …and other tabs still got the lock notification.
      expect(seen).toEqual([{ kind: 'vault-lock', key: vaultNameComparisonKey('demo') }]);
      listener.close();
      service.destroy();
    }, 20000);

    it('[P3] unlock re-checks the registry and reports STALE when the vault is removed mid-unlock', async () => {
      const service = createVaultService(registry);
      const attempt = service.unlock('demo', v.password);
      // The removal lands while the ~0.6s PBKDF2 derivation is running.
      await registry.removeVault('demo');
      await expect(attempt).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true });
      service.destroy();
    }, 20000);
  });
});
