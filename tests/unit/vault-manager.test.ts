// Vault manager tests (hierarchical per-key era). Storage runs on the
// hand-written fake IndexedDB (tests/mocks/fake-indexeddb.ts — see its
// FIDELITY BOUNDARY header); the seeded vaults are the fixed V1 fixture
// envelope (per-key iv/ciphertext/note) under the fixture password.
//
// ORDER INDEPENDENCE: every test rebuilds its own fake database, registry and
// manager in beforeEach and tears them down in afterEach — shuffle- and
// single-test safe (the A2/A3 standard).
//
// Performance: PBKDF2 600k costs ~0.5-0.8s per derivation. Exactly ONE is
// paid in beforeAll (the KEK that seals the shared import/merge source
// envelope); each test then pays only for the derivations its own calls
// perform (measured counts: create 1 + its verification unlock 1; unlock 1 —
// also 1 when the password is wrong, derivation precedes authentication;
// independent import 3 per success (source open 1 + createVault 1 + target
// KEK 1) or 1 on a wrong source password; merge without pre-unlock 3
// (manager's targetPassword unlock probe 1 + merge target/source KEKs 2), 1
// on a wrong target password; changePassword 2 plus verification derivations;
// the C2 race tests inject via a REAL second service/manager (its unlock
// counts 1, an addKey adds 1, a remove+recreate path adds 3) and verify
// through one re-unlock each). Per-test budgets are set as timeouts.
// Do not add unlock-happy tests without pruning.
//
// The BLUEPRINT HARD CONTRACT acceptance lives here: a successful merge
// orchestration must leave the target locked with lockEpoch +1 versus
// pre-merge, and a lock() persistence failure must still have cleared memory
// and propagate.
//
// MERGE CONTRACT (per-key era): importVaultDetailed(merge) authenticates the
// target with `targetPassword` itself — NO pre-unlock is imposed on the
// caller. The backup primitive's own session requirement (VAULT_LOCKED when
// the target is not selected) stays pinned in vault-backup.test.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { decryptVaultKey, deriveVaultKek, encryptVaultKeyRecord } from '@/lib/vault/crypto';
import { decodeBase64Url } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  createVaultManager,
  type VaultManagerExtended,
} from '@/lib/vault/manager';
import { VAULT_DB_NAME, openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import { createVaultService } from '@/lib/vault/service';
import type { VaultEnvelopeV1, VaultKeyInput, VaultRecordV1 } from '@/lib/vault/types';
import { vaultNameComparisonKey } from '@/lib/vault/validation';

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');

const BOB_WIF = '5Ktest-wif-bob-0001';
const SOURCE_PASSWORD = 'a-different-source-passphrase';
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

// changePassword's reads of the target vault through a gated registry, in
// order: unlock's initial read + born-stale recheck (2), the capture's
// requireRecord read (1) — so the 4th read is the getStatus guard's
// requireFreshSession re-read, the deterministic point BETWEEN the capture
// and the freshness guard where the C2 interleavings land. If the
// implementation changes the read order, these tests fail loudly rather than
// silently stop covering the window.
const GUARD_READ_INDEX = 4;

/**
 * Wrap a registry so the `getRecord` call changePassword's freshness guard
 * makes for the target vault first runs `interleave()` to completion and
 * settles BroadcastChannel delivery, then re-reads and returns the
 * POST-interleave record (what the real flow would observe). The concurrent
 * "other tab" must write through the RAW registry so the gate never
 * re-enters.
 */
function gateGuardRead(
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
        if (targetReads === GUARD_READ_INDEX) {
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
  overrides: Partial<VaultRecordV1> = {},
): VaultRecordV1 {
  return {
    ...v.envelope,
    version: 1,
    vaultName,
    revision: 0,
    lockEpoch: 0,
    createdAt: fakeClock++,
    updatedAt: fakeClock++,
    lastBackupAt: null,
    ...overrides,
  };
}

describe('vault manager (per-key hierarchy)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let manager: VaultManagerExtended;
  // Shared source backup for the independent import AND the merge (bob's
  // active key sealed once under SOURCE_PASSWORD with a fresh per-key IV).
  let sourceEnvelope: VaultEnvelopeV1;
  let bobSourceIv: string;

  beforeAll(async () => {
    const sourceKek = await deriveVaultKek(SOURCE_PASSWORD, decodeBase64Url(v.salt));
    const bobKey = await encryptVaultKeyRecord(sourceKek, BOB_WIF, 'bob public label', []);
    bobSourceIv = bobKey.iv;
    sourceEnvelope = {
      version: 1,
      vaultName: 'source-backup',
      salt: v.salt,
      accounts: [
        { accountName: 'bob', keys: { owner: [], active: [bobKey], posting: [], memo: [] } },
      ],
    };
    sourceKek.fill(0);
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo'));
    // alpha carries the same posting WIF under the fixture re-encryption IV.
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('alpha', {
        accounts: [
          {
            accountName: 'alice',
            keys: {
              owner: [], active: [], memo: [],
              posting: [{ iv: v.reencryption.iv, ciphertext: v.reencryption.ciphertext, note: 'alpha key' }],
            },
          },
        ],
      }),
    );
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('beta', { accounts: [] }));
    manager = createVaultManager(registry);
  });

  afterEach(() => {
    manager.destroy();
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

  /** Decrypt every key of a record under a password (verification helper). */
  const decryptRecord = async (record: VaultRecordV1, password: string): Promise<string[]> => {
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
  };

  describe('createVault / listVaults / activateVault', () => {
    it('creates a locked, inactive vault with an empty account list', async () => {
      const summary = await manager.createVault({ vaultName: 'Work', password: v.password });
      expect(summary).toMatchObject({ vaultName: 'Work', active: false, locked: true });
      const record = await currentRecord('Work');
      expect(record.revision).toBe(0);
      expect(record.accounts).toEqual([]);
      // The new vault's directory is readable while locked (public metadata).
      await manager.activateVault('Work');
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
    it('serves the public per-key directory locked; unlock authenticates; errors map', async () => {
      // No session and no active vault: nothing to resolve.
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
      // The active vault's directory is readable WITHOUT an unlock — outer
      // metadata (account, role, IV, note) is public by design.
      await manager.activateVault('demo');
      await expect(manager.getAccounts()).resolves.toEqual([
        {
          accountName: 'alice',
          keys: [
            { role: 'active', iv: active.iv, note: 'backup active key' },
            { role: 'posting', iv: posting.iv, note: 'desktop posting key' },
          ],
          balances: null,
        },
      ]);
      // Unlock authenticates the password (one probe key) and binds a session.
      await expect(manager.unlockVault('demo', v.password)).resolves.toMatchObject({
        locked: false,
        vaultName: 'demo',
      });
      await expect(manager.getAccounts()).resolves.toEqual([
        {
          accountName: 'alice',
          keys: [
            { role: 'active', iv: active.iv, note: 'backup active key' },
            { role: 'posting', iv: posting.iv, note: 'desktop posting key' },
          ],
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
        password: SOURCE_PASSWORD,
        vaultName: 'Imported',
      });
      expect(detailed.preMergeBackup).toBeNull();
      expect(detailed.summary).toMatchObject({ vaultName: 'Imported', active: false, locked: true });
      expect((await currentRecord('Imported')).salt).not.toBe(v.salt);
      // The A0-shaped importVault returns just the summary.
      const summary = await manager.importVault({
        mode: 'independent',
        envelope: sourceEnvelope,
        password: SOURCE_PASSWORD,
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

  describe('importVault (merge) — blueprint hard contract, target-password era', () => {
    it('merges WITHOUT a pre-unlock via targetPassword; locks the target: locked:true, lockEpoch +1, preMergeBackup delivered', async () => {
      const before = await currentRecord('demo');
      const detailed = await manager.importVaultDetailed({
        mode: 'merge',
        envelope: sourceEnvelope,
        password: SOURCE_PASSWORD,
        targetVaultName: 'demo',
        targetPassword: v.password,
      });
      // The hard-contract acceptance: locked after merge, epoch advanced.
      expect(detailed.summary).toMatchObject({ vaultName: 'demo', locked: true });
      const after = await currentRecord('demo');
      expect(after.lockEpoch).toBe(before.lockEpoch + 1);
      expect(after.revision).toBe(before.revision + 1);
      // The pre-merge snapshot is exactly the pre-merge four-field envelope.
      expect(detailed.preMergeBackup).toEqual({
        version: 1,
        vaultName: 'demo',
        salt: before.salt,
        accounts: before.accounts,
      });
      // The session is really gone: with no active vault selected there is
      // nothing left to resolve — signing-grade flows need a fresh selection.
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
      // Merged content is visible in the public directory (bob merged in —
      // re-encrypted under the target KEK with a fresh IV, his public note
      // carried over).
      const accounts = await manager.getAccounts('demo');
      expect(accounts.map((a) => a.accountName)).toEqual(['alice', 'bob']);
      const bobKey = accounts[1]?.keys[0];
      expect(bobKey).toMatchObject({ role: 'active', note: 'bob public label' });
      expect(bobKey?.iv).not.toBe(bobSourceIv);
    }, 60000);

    it('a wrong targetPassword is refused before any write leaves the record byte-identical', async () => {
      const before = await currentRecord('demo');
      await expectRejectedBy(
        manager.importVault({
          mode: 'merge',
          envelope: sourceEnvelope,
          password: SOURCE_PASSWORD,
          targetVaultName: 'demo',
          targetPassword: 'wrong-password-123456',
        }),
        'VAULT_PASSWORD_INVALID',
      );
      expect(await currentRecord('demo')).toEqual(before);
    }, 30000);

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
        await expectRejectedBy(
          doomed.importVault({
            mode: 'merge',
            envelope: sourceEnvelope,
            password: SOURCE_PASSWORD,
            targetVaultName: 'demo',
            targetPassword: v.password,
          }),
          'VAULT_STORAGE_UNAVAILABLE',
        );
        // Memory was cleared BEFORE the failed persist: with no session and
        // no active vault the manager reports VAULT_EMPTY, not a stale session.
        await expectRejectedBy(doomed.getAccounts(), 'VAULT_EMPTY');
        // The merge write itself was durable (CAS succeeded pre-lock).
        const record = await currentRecord('demo');
        expect(record.revision).toBe(1);
      } finally {
        doomed.destroy();
      }
    }, 60000);
  });

  describe('changePassword', () => {
    it('re-encrypts every key under a fresh salt with fresh IVs; new password unlocks, old fails; ends locked', async () => {
      // Hide BroadcastChannel BEFORE creating the second manager so its
      // invalidation is proven through the HARD LINE only (the acceleration
      // layer would turn the final assertion into EMPTY — valid, but
      // timing-dependent; see the A2 service suite's no-BC pattern).
      hideBroadcastChannel();
      const registryB = await openVaultRegistry();
      // A raw second service (not a manager): the cross-tab hard line is a
      // session-status contract, and the manager surface resolves directory
      // reads without consulting the session (public data by design).
      const other = createVaultService(registryB);
      try {
        await other.unlock('demo', v.password);
        const before = await currentRecord('demo');
        await manager.changePassword('demo', v.password, NEW_PASSWORD);
        const after = await currentRecord('demo');
        // Fresh salt + fresh per-key IVs/ciphertexts, revision +1, lockEpoch
        // +1 (post-change lock).
        expect(after.salt).not.toBe(before.salt);
        expect(after.revision).toBe(before.revision + 1);
        expect(after.lockEpoch).toBe(before.lockEpoch + 1);
        expect(after.accounts[0]?.keys.posting[0]?.iv).not.toBe(posting.iv);
        expect(after.accounts[0]?.keys.active[0]?.iv).not.toBe(active.iv);
        // Every WIF survived the re-encryption under the new password.
        expect(await decryptRecord(after, NEW_PASSWORD)).toEqual([
          active.privateKey,
          posting.privateKey,
        ]);
        // Locked after the change…
        await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
        // …the new password unlocks and the directory survived…
        await manager.unlockVault('demo', NEW_PASSWORD);
        await expect(manager.getAccounts('demo')).resolves.toBeTruthy();
        // …and the old password no longer authenticates.
        await expectRejectedBy(manager.unlockVault('demo', v.password), 'VAULT_PASSWORD_INVALID');
        // Another tab's pre-change session is stale (the revision moved).
        await expectRejectedBy(other.getStatus(), 'VAULT_SESSION_STALE');
      } finally {
        other.destroy();
        registryB.close();
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

  describe('changePassword cross-tab races in the capture→CAS window (review r2 C2)', () => {
    // C2 regression: a cross-tab write landing while changePassword is
    // between its capture and its CAS. Two independent guards must catch it:
    // (a) the CAS pointer comes from the CAPTURE (not a post-mutation
    // re-read), so the swap itself rejects a concurrent revision bump;
    // (b) the pre-CAS freshness guard re-reads the record through the
    // session's hard line and clears + rejects on pointer drift (the
    // `status.locked` return-value check converges on the same STALE outcome
    // whenever the broadcast acceleration beats the guard to it).

    const bobKeyInput = (): VaultKeyInput => ({
      vaultName: 'demo',
      accountName: 'bob',
      role: 'active',
      privateKey: BOB_WIF,
      note: 'concurrent write',
      password: v.password,
    });

    it('a cross-tab mutation landing after the guard but before the CAS → STALE; the concurrent key survives, no new envelope', async () => {
      let injected = false;
      let concurrentRecord: VaultRecordV1 | null = null;
      const tabB = createVaultService(registry);
      const gated: VaultRegistry = {
        ...registry,
        async swapRecord(expected, next) {
          if (vaultNameComparisonKey(expected.vaultName) === vaultNameComparisonKey('demo') && !injected) {
            injected = true;
            await tabB.unlock('demo', v.password);
            await tabB.addKey(bobKeyInput());
            concurrentRecord = await registry.getRecord('demo');
            await waitBroadcast();
          }
          return registry.swapRecord(expected, next);
        },
      };
      const tabA = createVaultManager(gated);
      try {
        await expectRejectedBy(
          tabA.changePassword('demo', v.password, NEW_PASSWORD),
          'VAULT_SESSION_STALE',
        );
        expect(injected).toBe(true);
        // Storage keeps the concurrent write byte-for-byte: bob's mutation at
        // revision 1, epoch 0, the ORIGINAL salt (no fresh-salt re-encryption
        // — a password change mints one).
        const after = await currentRecord('demo');
        expect(after).toEqual(concurrentRecord);
        expect(after.revision).toBe(1);
        expect(after.lockEpoch).toBe(0);
        expect(after.salt).toBe(v.salt);
        // And the directory really still carries both accounts.
        const accounts = await tabA.getAccounts('demo');
        expect(accounts.map((a) => a.accountName).sort()).toEqual(['alice', 'bob']);
      } finally {
        tabA.destroy();
        tabB.destroy();
      }
    }, 60000);

    it('a cross-tab mutation landing between the capture and the guard → the hard line catches the revision drift', async () => {
      // Same interleaving, earlier window: the guard's requireFreshSession
      // re-read observes the post-mutation record and rejects — belt and
      // suspenders for the CAS-only path above.
      let injected = false;
      const tabB = createVaultService(registry);
      const gated = gateGuardRead(registry, 'demo', async () => {
        injected = true;
        await tabB.unlock('demo', v.password);
        await tabB.addKey(bobKeyInput());
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
        const accounts = await tabA.getAccounts('demo');
        expect(accounts.map((a) => a.accountName).sort()).toEqual(['alice', 'bob']);
      } finally {
        tabA.destroy();
        tabB.destroy();
      }
    }, 60000);

    it('a same-count remove+recreate in the same window → STALE; the recreated instance is not overwritten', async () => {
      // Second C2 shape: another tab removes the vault and recreates the
      // SAME name. The recreated record's counters restart at 0/0 — exactly
      // what the seeded original had — so only the pointer's createdAt
      // binding stands between the stale captured plaintext and the
      // recreated instance.
      let injected = false;
      let recreatedSnapshot: VaultRecordV1 | null = null;
      const tabB = createVaultManager(registry);
      const gated = gateGuardRead(registry, 'demo', async () => {
        injected = true;
        // B holds the session, so its removeVault locks first after the
        // probe authentication, then the recreate mints a fresh salt.
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
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
    }, 30000);

    it('naming the current session vault is a local lock', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      await manager.lockVault('demo');
      expect((await currentRecord('demo')).lockEpoch).toBe(before.lockEpoch + 1);
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
    }, 30000);

    it('naming another vault remote-locks it: epoch bump, other sessions go STALE, local session untouched', async () => {
      const registryB = await openVaultRegistry();
      const other = createVaultService(registryB);
      try {
        await other.unlock('alpha', v.password);
        await manager.unlockVault('demo', v.password); // an unrelated live session
        const before = await currentRecord('alpha');
        await manager.lockVault('alpha');
        expect((await currentRecord('alpha')).lockEpoch).toBe(before.lockEpoch + 1);
        // The tab holding alpha unlocked is stale on its next session-bound
        // operation — deterministic: the remote path bumps the registry
        // directly and never broadcasts, so only the hard line can catch it.
        await expectRejectedBy(other.getStatus(), 'VAULT_SESSION_STALE');
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
      // The old session cannot operate — the record is gone from its old
      // name, so the session-bound resolution fails closed (NOT_FOUND; the
      // session never silently follows the rename).
      await expectRejectedBy(manager.getAccounts(), 'VAULT_NOT_FOUND');
      // KNOWN WRINKLE (pinned, not endorsed): the lingering session's next
      // unlock first tries to lock the renamed-away record and fails with
      // NOT_FOUND — but lock() clears memory BEFORE the persist, so the
      // stale session is gone and the retry succeeds.
      await expectRejectedBy(manager.unlockVault('Renamed', v.password), 'VAULT_NOT_FOUND');
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
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
    }, 30000);

    it('export returns the four-field envelope and stamps lastBackupAt; the session is locked first', async () => {
      await manager.unlockVault('demo', v.password);
      const before = await currentRecord('demo');
      const envelope = await manager.exportVault('demo');
      expect(envelope).toEqual({
        version: 1,
        vaultName: 'demo',
        salt: before.salt,
        accounts: before.accounts,
      });
      expect(Object.keys(envelope).sort()).toEqual(['accounts', 'salt', 'vaultName', 'version']);
      const after = await currentRecord('demo');
      expect(after.lastBackupAt).not.toBeNull();
      // lock() bumps only the epoch; the export CAS bumps the revision.
      expect(after.revision).toBe(before.revision + 1);
      expect(after.lockEpoch).toBe(before.lockEpoch + 1);
      // The pre-export lock cleared the session (no zombie left behind by the
      // export's revision bump).
      await expectRejectedBy(manager.getAccounts(), 'VAULT_EMPTY');
      await expectRejectedBy(manager.exportVault('ghost'), 'VAULT_NOT_FOUND');
    }, 30000);
  });
});
