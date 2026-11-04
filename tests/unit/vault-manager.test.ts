// Vault manager tests (A4). Storage runs on the hand-written fake IndexedDB
// (tests/mocks/fake-indexeddb.ts — see its FIDELITY BOUNDARY header); the
// seeded vaults decrypt REAL fixture ciphertexts under the fixture password.
//
// ORDER INDEPENDENCE: every test rebuilds its own fake database, registry and
// manager in beforeEach and tears them down in afterEach — shuffle- and
// single-test safe (the A2/A3 standard).
//
// Performance: PBKDF2 600k costs ~0.5-0.8s per derivation. Exactly ONE is
// paid in beforeAll (the KEK that seals the shared import/merge source
// envelope); each test then pays only for the derivations its own calls
// perform (measured counts: create 1; unlock 1 — also 1 when the password
// is wrong, derivation precedes authentication; independent import 3 per
// success — backup-envelope open 1 + registry createVault 1 + the import's
// internal session unlock 1 — or 1 on a wrong source password; merge 1
// after its pre-unlock (the post-merge lock derives nothing) plus the
// re-unlock; changePassword 2 plus verification re-unlocks; probe
// authentications 1). The review-r2 C2 race tests inject via a REAL second
// service/manager (its unlock counts 1, a removeVault adds its probe 1 and
// a recreate's createVault 1) and verify through one re-unlock each.
// Whole-file budget: 48 derivations (1 beforeAll + 47 in-test); per-test
// budgets are set as timeouts.
// Do not add unlock-happy tests without pruning.
//
// The BLUEPRINT HARD CONTRACT acceptance lives here: a successful merge
// orchestration must leave the target locked with lockEpoch +1 versus
// pre-merge, and a lock() persistence failure must still have cleared memory
// and propagate.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { deriveVaultKek, encryptVaultText, generateVaultIv } from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url, validateVaultPayloadText } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  createVaultManager,
  type VaultManagerExtended,
} from '@/lib/vault/manager';
import { VAULT_DB_NAME, openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import { createVaultService } from '@/lib/vault/service';
import type { VaultEnvelopeV1, VaultKeyEntry, VaultRecordV1 } from '@/lib/vault/types';
import { vaultNameComparisonKey } from '@/lib/vault/validation';

const v = vectors.vault;

const fixtureKeys = validateVaultPayloadText(v.payloadText).keys;
const aliceEntry: VaultKeyEntry | undefined = fixtureKeys[0];
if (!aliceEntry) {
  throw new Error('fixture payload has no key entry');
}
const aliceWif = aliceEntry.privateKey;
const alicePublicKey = `STM${aliceWif.slice(-8)}`; // mock getPublicKey: 'STM' + last 8
const BOB_ENTRY: VaultKeyEntry = { accountName: 'bob', role: 'active', privateKey: '5Ktest-wif-bob-0001' };
const bobPublicKey = `STM${BOB_ENTRY.privateKey.slice(-8)}`;

const NEW_PASSWORD = 'a-perfectly-fine-new-passphrase';

/** Async rejection-code assertion helper (accepts a promise or a thunk). */
async function expectRejectedBy(
  promiseOrThunk: Promise<unknown> | (() => Promise<unknown>),
  code: string,
): Promise<void> {
  const promise =
    typeof promiseOrThunk === 'function' ? promiseOrThunk() : promiseOrThunk;
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe(code);
}

let fakeClock = 1_700_300_000_000;

// BroadcastChannel plumbing shared by the cross-tab race tests: vitest jsdom
// exposes Node's own BroadcastChannel (real delivery; an instance never
// receives its own messages), so acceleration events can be hidden for
// hard-line-only determinism and settled for delivery — the vault-service
// suite's established pattern.
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

/** Let Node deliver queued BroadcastChannel acceleration events. */
const waitBroadcast = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 25);
  });

// changePassword's reads of the target record through a gated registry, in
// order: unlock's initial read + born-stale recheck (2), the payload
// capture's requireFreshSession read (1) — so the 4th read is
// requireRecord's, the deterministic point BETWEEN the capture and the
// freshness guard where review-r2's C2 interleavings land.
const REQUIRE_RECORD_READ_INDEX = 4;

/**
 * Wrap a registry so the `getRecord` call changePassword's `requireRecord`
 * makes for the target vault first runs `interleave()` to completion and
 * settles BroadcastChannel delivery, then re-reads and returns the
 * POST-interleave record (what the real flow would observe). The concurrent
 * "other tab" must write through the RAW registry so the gate never
 * re-enters. Pinned to the current changePassword read sequence — if the
 * implementation changes the read order, these tests fail loudly rather
 * than silently stop covering the window.
 */
function gateRequireRecord(
  base: VaultRegistry,
  targetVaultName: string,
  interleave: () => Promise<void>,
): VaultRegistry {
  const targetKey = vaultNameComparisonKey(targetVaultName);
  let targetReads = 0;
  return {
    ...base,
    async getRecord(vaultName: string) {
      if (vaultNameComparisonKey(vaultName) === targetKey) {
        targetReads += 1;
        if (targetReads === REQUIRE_RECORD_READ_INDEX) {
          await interleave();
          await waitBroadcast();
        }
      }
      return base.getRecord(vaultName);
    },
  };
}

function makeRecord(
  vaultName: string,
  envelope: { salt: string; iv: string; ciphertext: string },
): VaultRecordV1 {
  return {
    version: 1,
    vaultName,
    salt: envelope.salt,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    revision: 0,
    lockEpoch: 0,
    createdAt: fakeClock++,
    updatedAt: fakeClock++,
    lastBackupAt: null,
  };
}

describe('vault manager (A4)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let manager: VaultManagerExtended;
  // Shared source backup for the independent import AND the merge migration
  // (one payload — bob's active key — sealed once under the fixture password).
  let sourceEnvelope: VaultEnvelopeV1;

  beforeAll(async () => {
    const kek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    const iv = generateVaultIv();
    sourceEnvelope = {
      version: 1,
      vaultName: 'source-backup',
      salt: v.salt,
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(
        await encryptVaultText(kek, iv, JSON.stringify({ keys: [BOB_ENTRY] })),
      ),
    };
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo', { salt: v.salt, iv: v.iv, ciphertext: v.ciphertext }));
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('alpha', { salt: v.salt, iv: v.reencryption.iv, ciphertext: v.reencryption.ciphertext }),
    );
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('beta', { salt: v.salt, iv: v.emptyPayload.iv, ciphertext: v.emptyPayload.ciphertext }),
    );
    manager = createVaultManager(registry);
  });

  afterEach(() => {
    manager.destroy();
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

  describe('createVault / listVaults / activateVault', () => {
    it('creates a locked, inactive vault with the empty payload', async () => {
      const summary = await manager.createVault({ vaultName: 'Work', password: v.password });
      expect(summary).toMatchObject({ vaultName: 'Work', active: false, locked: true });
      const record = await currentRecord('Work');
      expect(record.revision).toBe(0);
      // Decrypting the stored ciphertext is NOT needed to prove emptiness —
      // unlocking the new vault yields zero accounts (1 derivation).
      await manager.unlockVault('Work', v.password);
      await expect(manager.getAccounts()).resolves.toEqual([]);
    }, 30000);

    it('rejects weak passwords and duplicate aliases without deriving', async () => {
      await expectRejectedBy(
        manager.createVault({ vaultName: 'Weak', password: 'password' }),
        'VAULT_PASSWORD_WEAK',
      );
      await expectRejectedBy(
        manager.createVault({ vaultName: 'demo', password: v.password }),
        'VAULT_NAME_EXISTS',
      );
      await expectRejectedBy(
        manager.createVault({ vaultName: 'DEMO', password: v.password }),
        'VAULT_NAME_EXISTS',
      );
      expect((await registry.listRecords()).map((r) => r.vaultName).sort()).toEqual([
        'alpha',
        'beta',
        'demo',
      ]);
    });

    it('listVaults maps active (settings) and locked (session) per record', async () => {
      await manager.activateVault('alpha');
      let list = await manager.listVaults();
      expect(list.map((s) => [s.vaultName, s.active, s.locked])).toEqual([
        ['alpha', true, true],
        ['beta', false, true],
        ['demo', false, true],
      ]);
      await manager.unlockVault('demo', v.password);
      list = await manager.listVaults();
      expect(list.map((s) => [s.vaultName, s.active, s.locked])).toEqual([
        ['alpha', true, true],
        ['beta', false, true],
        ['demo', false, false],
      ]);
      await expectRejectedBy(manager.activateVault('ghost'), 'VAULT_NOT_FOUND');
    }, 30000);
  });

  describe('getAccounts / unlockVault', () => {
    it('exposes session-bound account summaries; locked → VAULT_LOCKED', async () => {
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
      await manager.unlockVault('demo', v.password);
      await expect(manager.getAccounts()).resolves.toEqual([
        {
          accountName: 'alice',
          keys: [{ accountName: 'alice', role: 'posting', publicKey: alicePublicKey }],
          balances: null,
        },
      ]);
      await expectRejectedBy(manager.unlockVault('demo', 'wrong-password-123456'), 'VAULT_PASSWORD_INVALID');
      await expectRejectedBy(manager.unlockVault('ghost', v.password), 'VAULT_NOT_FOUND');
    }, 30000);
  });

  describe('importVault (independent)', () => {
    it('creates a new locked vault from a backup; no pre-merge snapshot; no activation', async () => {
      const detailed = await manager.importVaultDetailed({
        mode: 'independent',
        envelope: sourceEnvelope,
        password: v.password,
        vaultName: 'Imported',
      });
      expect(detailed.preMergeBackup).toBeNull();
      expect(detailed.summary).toMatchObject({ vaultName: 'Imported', active: false, locked: true });
      // The A0-shaped importVault returns just the summary.
      const summary = await manager.importVault({
        mode: 'independent',
        envelope: sourceEnvelope,
        password: v.password,
        vaultName: 'Second',
      });
      expect(summary).toMatchObject({ vaultName: 'Second', locked: true });
      // A password that cannot authenticate the source backup is refused
      // (the weak-source-policy branch is the A3 primitive's own contract).
      await expectRejectedBy(
        manager.importVault({
          mode: 'independent',
          envelope: sourceEnvelope,
          password: 'wrong-password-123456',
          vaultName: 'Third',
        }),
        'VAULT_PASSWORD_INVALID',
      );
      expect((await registry.listRecords()).map((r) => r.vaultName).sort()).toEqual([
        'Imported',
        'Second',
        'alpha',
        'beta',
        'demo',
      ]);
    }, 60000);
  });

  describe('importVault (merge) — blueprint hard contract', () => {
    it('locks the target after a successful merge: locked:true, lockEpoch +1, preMergeBackup delivered', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      const detailed = await manager.importVaultDetailed({
        mode: 'merge',
        envelope: sourceEnvelope,
        password: v.password,
        targetVaultName: 'demo',
      });
      // The hard-contract acceptance: locked after merge, epoch advanced.
      expect(detailed.summary).toMatchObject({ vaultName: 'demo', locked: true });
      const after = await currentRecord('demo');
      expect(after.lockEpoch).toBe(before.lockEpoch + 1);
      expect(after.revision).toBe(before.revision + 1);
      // The pre-merge snapshot is exactly the pre-merge five-field envelope.
      expect(detailed.preMergeBackup).not.toBeNull();
      expect(detailed.preMergeBackup).toEqual({
        version: before.version,
        vaultName: before.vaultName,
        salt: before.salt,
        iv: before.iv,
        ciphertext: before.ciphertext,
      });
      // The session is really gone: signing-grade reads require a re-unlock.
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
      // And the merged content is intact under the re-unlock (bob merged in).
      await manager.unlockVault('demo', v.password);
      const accounts = await manager.getAccounts();
      expect(accounts.map((a) => a.accountName).sort()).toEqual(['alice', 'bob']);
      expect(accounts[1]).toMatchObject({
        accountName: 'bob',
        keys: [{ accountName: 'bob', role: 'active', publicKey: bobPublicKey }],
      });
    }, 60000);

    it('requires the target unlocked in this manager (VAULT_LOCKED otherwise)', async () => {
      await expectRejectedBy(
        manager.importVault({
          mode: 'merge',
          envelope: sourceEnvelope,
          password: v.password,
          targetVaultName: 'demo',
        }),
        'VAULT_LOCKED',
      );
      // Nothing was written.
      const record = await currentRecord('demo');
      expect(record.revision).toBe(0);
    });

    it('a lock() persistence failure after the merge still clears memory and propagates', async () => {
      // bumpLockEpoch — the registry primitive only service.lock() uses — is
      // made to fail AFTER the merge itself succeeded.
      const failing: VaultRegistry = {
        ...registry,
        bumpLockEpoch: () =>
          Promise.reject(new VaultError('VAULT_STORAGE_UNAVAILABLE', 'injected bump failure')),
      };
      const doomed = createVaultManager(failing);
      try {
        await doomed.unlockVault('demo', v.password);
        await expectRejectedBy(
          doomed.importVault({
            mode: 'merge',
            envelope: sourceEnvelope,
            password: v.password,
            targetVaultName: 'demo',
          }),
          'VAULT_STORAGE_UNAVAILABLE',
        );
        // Memory was cleared BEFORE the failed persist: the manager reports
        // plain VAULT_LOCKED, not a stale session.
        await expectRejectedBy(doomed.getAccounts(), 'VAULT_LOCKED');
        // The merge write itself was durable (CAS succeeded pre-lock).
        const record = await currentRecord('demo');
        expect(record.revision).toBe(1);
      } finally {
        doomed.destroy();
      }
    }, 60000);
  });

  describe('changePassword', () => {
    it('re-encrypts under a new salt; new password unlocks, old fails; ends locked', async () => {
      // Hide BroadcastChannel BEFORE creating the second manager so its
      // invalidation is proven through the HARD LINE only (the acceleration
      // layer would turn the final assertion into LOCKED — valid, but
      // timing-dependent; see the A2 service suite's no-BC pattern).
      const broadcastDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
      Object.defineProperty(globalThis, 'BroadcastChannel', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const registryB = await openVaultRegistry();
      const other = createVaultManager(registryB);
      try {
        await other.unlockVault('demo', v.password);
        // The manager starts WITHOUT a session: changePassword authenticates
        // on its own (unlocking an already-unlocked vault would first switch
        // — lock + re-unlock — and bump the epoch twice; the switch-clears
        // semantics are the A2 service contract, not this flow's target).
        const before = await currentRecord('demo');
        await manager.changePassword('demo', v.password, NEW_PASSWORD);
        const after = await currentRecord('demo');
        // Fresh salt + fresh ciphertext, revision +1, lockEpoch +1 (post-change lock).
        expect(after.salt).not.toBe(before.salt);
        expect(after.ciphertext).not.toBe(before.ciphertext);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.lockEpoch).toBe(before.lockEpoch + 1);
        // Locked after the change…
        await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
        // …the new password unlocks and the payload survived…
        await manager.unlockVault('demo', NEW_PASSWORD);
        await expect(manager.getAccounts()).resolves.toBeTruthy();
        // …and the old password no longer authenticates.
        await expectRejectedBy(manager.unlockVault('demo', v.password), 'VAULT_PASSWORD_INVALID');
        // Another tab's pre-change session is stale (the revision moved).
        await expectRejectedBy(other.getAccounts(), 'VAULT_SESSION_STALE');
      } finally {
        other.destroy();
        registryB.close();
        if (broadcastDescriptor) {
          Object.defineProperty(globalThis, 'BroadcastChannel', broadcastDescriptor);
        } else {
          delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
        }
      }
    }, 60000);

    it('authentication first, policy second: wrong old / weak new are rejected untouched', async () => {
      // Order matters for the counters: each failing call below must leave
      // the stored record at 0/0. (A FAILED changePassword may legitimately
      // leave the session unlocked — the old password WAS correctly entered —
      // but it never writes: no revision bump, no epoch bump.)
      await expectRejectedBy(
        manager.changePassword('ghost', v.password, NEW_PASSWORD),
        'VAULT_NOT_FOUND',
      );
      await expectRejectedBy(
        manager.changePassword('demo', 'wrong-password-123456', NEW_PASSWORD),
        'VAULT_PASSWORD_INVALID',
      );
      await expectRejectedBy(
        manager.changePassword('demo', v.password, 'password'),
        'VAULT_PASSWORD_WEAK',
      );
      const record = await currentRecord('demo');
      expect(record.revision).toBe(0);
      expect(record.lockEpoch).toBe(0);
    }, 30000);
  });

  describe('changePassword cross-tab races in the capture→guard window (review r2 C2)', () => {
    // C2 regression: a cross-tab write landing between the payload capture
    // and the pre-CAS freshness guard. changePassword must CHECK the value
    // getStatus returns — the service answers a CLEARED session with
    // `{ locked: true }` and does NOT throw (the hard line inside it never
    // runs without a session to compare) — otherwise the stale captured
    // plaintext gets re-encrypted over the concurrent write: the swap's CAS
    // pointer comes from the POST-mutation requireRecord read, so the CAS
    // itself cannot catch it.

    it('a cross-tab mutation clearing the session mid-flow → STALE; the concurrent key survives, no new envelope', async () => {
      // Tab B (a real second service over the same storage) bumps the
      // revision and its vault-mutate acceleration event clears tab A's
      // freshly-unlocked session — the exact interleaving where an unchecked
      // getStatus guard is a no-op.
      let injected = false;
      let concurrentRecord: VaultRecordV1 | null = null;
      const tabB = createVaultService(registry);
      const gated = gateRequireRecord(registry, 'demo', async () => {
        injected = true;
        await tabB.unlock('demo', v.password);
        await tabB.mutatePayload((draft) => {
          draft.keys.push({ ...BOB_ENTRY });
        });
        concurrentRecord = await registry.getRecord('demo');
      });
      const tabA = createVaultManager(gated);
      try {
        await expectRejectedBy(
          tabA.changePassword('demo', v.password, NEW_PASSWORD),
          'VAULT_SESSION_STALE',
        );
        expect(injected).toBe(true);
        // Storage keeps the concurrent write byte-for-byte: bob's mutation at
        // revision 1, epoch 0, the ORIGINAL salt (no fresh-salt re-encryption
        // — a password change mints one) and B's IV/ciphertext untouched.
        const after = await currentRecord('demo');
        expect(after).toEqual(concurrentRecord);
        expect(after.revision).toBe(1);
        expect(after.lockEpoch).toBe(0);
        expect(after.salt).toBe(v.salt);
        // And the payload really still carries both keys: the rollback shape
        // would leave only alice.
        await tabA.unlockVault('demo', v.password);
        const accounts = await tabA.getAccounts();
        expect(accounts.map((a) => a.accountName).sort()).toEqual(['alice', 'bob']);
        const bob = accounts.find((a) => a.accountName === 'bob');
        expect(bob?.keys).toEqual([
          { accountName: 'bob', role: 'active', publicKey: bobPublicKey },
        ]);
      } finally {
        tabA.destroy();
        tabB.destroy();
      }
    }, 60000);

    it('same interleave with BroadcastChannel hidden → the hard line catches the revision drift (deterministic backstop)', async () => {
      // Belt-and-suspenders for the broadcast-timing-dependent test above:
      // with no acceleration layer at all, the session survives in memory
      // and the guard's getStatus runs the four-field hard line, sees the
      // revision drift and clears + rejects. STALE either way.
      hideBroadcastChannel();
      let injected = false;
      const tabB = createVaultService(registry);
      const gated = gateRequireRecord(registry, 'demo', async () => {
        injected = true;
        await tabB.unlock('demo', v.password);
        await tabB.mutatePayload((draft) => {
          draft.keys.push({ ...BOB_ENTRY });
        });
      });
      const tabA = createVaultManager(gated);
      try {
        await expectRejectedBy(
          tabA.changePassword('demo', v.password, NEW_PASSWORD),
          'VAULT_SESSION_STALE',
        );
        expect(injected).toBe(true);
        const after = await currentRecord('demo');
        expect(after.revision).toBe(1);
        expect(after.lockEpoch).toBe(0);
        expect(after.salt).toBe(v.salt);
        await tabA.unlockVault('demo', v.password);
        const accounts = await tabA.getAccounts();
        expect(accounts.map((a) => a.accountName).sort()).toEqual(['alice', 'bob']);
      } finally {
        tabA.destroy();
        tabB.destroy();
        restoreBroadcastChannel();
      }
    }, 60000);

    it('a same-count remove+recreate in the same window → STALE; the recreated instance is not overwritten', async () => {
      // Second C2 shape: another tab removes the vault and recreates the
      // SAME name. The recreated record's counters restart at 0/0 — exactly
      // what the seeded original had — and the removal flow's lock broadcast
      // clears tab A's session, so only the guard's return-value check
      // stands between the stale captured plaintext and the recreated
      // instance.
      let injected = false;
      let recreatedSnapshot: VaultRecordV1 | null = null;
      const tabB = createVaultManager(registry);
      const gated = gateRequireRecord(registry, 'demo', async () => {
        injected = true;
        // B holds the session, so its removeVault locks first (broadcast —
        // clears tab A's session) after the probe authentication.
        await tabB.unlockVault('demo', v.password);
        await tabB.removeVault('demo', v.password);
        await tabB.createVault({ vaultName: 'demo', password: v.password });
        recreatedSnapshot = await registry.getRecord('demo');
      });
      const tabA = createVaultManager(gated);
      try {
        expect(recreatedSnapshot).toBeNull(); // sanity: injected only mid-flow
        await expectRejectedBy(
          tabA.changePassword('demo', v.password, NEW_PASSWORD),
          'VAULT_SESSION_STALE',
        );
        expect(injected).toBe(true);
        // The recreated instance survived byte-for-byte: fresh-salt empty
        // vault at 0/0 — not the old plaintext under a new-password envelope.
        const after = await currentRecord('demo');
        expect(after).toEqual(recreatedSnapshot);
        expect(after.revision).toBe(0);
        expect(after.lockEpoch).toBe(0);
        expect(after.salt).not.toBe(v.salt);
        // Functionally: the vault still opens with the recreate password and
        // is EMPTY — alice must not be resurrected by the old plaintext.
        await tabA.unlockVault('demo', v.password);
        await expect(tabA.getAccounts()).resolves.toEqual([]);
      } finally {
        tabA.destroy();
        tabB.destroy();
      }
    }, 60000);
  });

  describe('lockVault — two semantics', () => {
    it('no argument locks the current session (epoch +1)', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      await manager.lockVault();
      expect((await currentRecord('demo')).lockEpoch).toBe(before.lockEpoch + 1);
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
    }, 30000);

    it('naming the current session vault is a local lock', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      await manager.lockVault('demo');
      expect((await currentRecord('demo')).lockEpoch).toBe(before.lockEpoch + 1);
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
    }, 30000);

    it('naming another vault remote-locks it: epoch bump, other sessions go STALE, local session untouched', async () => {
      const registryB = await openVaultRegistry();
      const other = createVaultManager(registryB);
      try {
        await other.unlockVault('alpha', v.password);
        await manager.unlockVault('demo', v.password); // an unrelated live session
        const before = await currentRecord('alpha');
        await manager.lockVault('alpha');
        expect((await currentRecord('alpha')).lockEpoch).toBe(before.lockEpoch + 1);
        // The tab holding alpha unlocked is stale on its next operation —
        // deterministic: the remote path bumps the registry directly and
        // never broadcasts, so only the hard line can catch it.
        await expectRejectedBy(other.getAccounts(), 'VAULT_SESSION_STALE');
        // …while the locking tab's own session (demo) is untouched.
        await expect(manager.getAccounts()).resolves.toBeTruthy();
        // Unknown names still surface VAULT_NOT_FOUND.
        await expectRejectedBy(manager.lockVault('ghost'), 'VAULT_NOT_FOUND');
      } finally {
        other.destroy();
        registryB.close();
      }
    }, 60000);
  });

  describe('renameVault / removeVault / exportVault', () => {
    it('renames; an unlocked session on the old name goes stale; the settings pointer follows', async () => {
      await manager.activateVault('demo');
      await manager.unlockVault('demo', v.password);
      await manager.renameVault('demo', 'Renamed');
      expect(await registry.getRecord('demo')).toBeNull();
      const record = await currentRecord('Renamed');
      expect(record.revision).toBe(0);
      // The active pointer followed the rename.
      expect((await registry.getSettings()).activeVaultName).toBe('Renamed');
      // The old session cannot operate — the record is gone from its name.
      await expectRejectedBy(manager.getAccounts(), 'VAULT_SESSION_STALE');
      await expect(manager.unlockVault('Renamed', v.password)).resolves.toMatchObject({
        locked: false,
        vaultName: 'Renamed',
      });
      await expectRejectedBy(manager.renameVault('Renamed', 'alpha'), 'VAULT_NAME_EXISTS');
    }, 30000);

    it('removes only after password authentication; dangling active pointer is cleared', async () => {
      await manager.activateVault('demo');
      await expectRejectedBy(
        manager.removeVault('demo', 'wrong-password-123456'),
        'VAULT_PASSWORD_INVALID',
      );
      expect(await registry.getRecord('demo')).not.toBeNull();
      // An unrelated live session (alpha) must survive the removal flow.
      await manager.unlockVault('alpha', v.password);
      await manager.removeVault('demo', v.password);
      expect(await registry.getRecord('demo')).toBeNull();
      expect((await registry.getSettings()).activeVaultName).toBeNull();
      await expect(manager.getAccounts()).resolves.toBeTruthy(); // alpha session intact
      await expectRejectedBy(manager.removeVault('demo', v.password), 'VAULT_NOT_FOUND');
    }, 40000);

    it('removing the currently-unlocked vault clears the session first', async () => {
      await manager.unlockVault('demo', v.password);
      await manager.removeVault('demo', v.password);
      expect(await registry.getRecord('demo')).toBeNull();
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
    }, 30000);

    it('export returns the five-field envelope and stamps lastBackupAt; the session is locked first', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      const envelope = await manager.exportVault('demo');
      expect(envelope).toEqual({
        version: 1,
        vaultName: 'demo',
        salt: before.salt,
        iv: before.iv,
        ciphertext: before.ciphertext,
      });
      const after = await currentRecord('demo');
      expect(after.lastBackupAt).not.toBeNull();
      // lock() bumps only the epoch; the export CAS bumps the revision.
      expect(after.revision).toBe(before.revision + 1);
      expect(after.lockEpoch).toBe(before.lockEpoch + 1);
      // The pre-export lock cleared the session (no zombie left behind by the
      // export's revision bump).
      await expectRejectedBy(manager.getAccounts(), 'VAULT_LOCKED');
      await expectRejectedBy(manager.exportVault('ghost'), 'VAULT_NOT_FOUND');
    }, 30000);
  });
});
