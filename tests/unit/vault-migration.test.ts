// A6-T5 plaintext migration — unit coverage of the verified-readback
// deletion gate (the A6 kickoff red line): the localStorage plaintext is
// deleted ONLY after (a) the encrypted write, (b) a registry re-read, and
// (c) an authenticated decrypt whose derived public key matches. Storage
// runs on the hand-written fake IndexedDB (tests/mocks/fake-indexeddb.ts)
// with the fixed V1 fixture envelope under the fixture password; jsdom
// provides real localStorage and Node's WebCrypto.
//
// DELETION-GATE MUTATION CHECK (run manually when touching migration.ts):
// the "readback failure" and "derived-key mismatch" tests below are the
// mutation killers for a delete-on-write-success regression — moving
// clearRememberedPostingKey() earlier makes exactly those two tests fail
// (the plaintext would be gone while verification never ran to completion).
// Re-run them after any change to the gate's ordering; the recorded proof
// lives in the PR body.
//
// The vitest steem-js mock derives 'STM' + last 8 chars of the WIF, so
// expected public keys are computed through validateVaultWif itself; the
// fixture ciphertexts still decrypt to the REAL fixture WIFs (real AES-GCM),
// which is what the readback verification consumes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import { deriveVaultKek, encryptVaultKey } from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  MIGRATED_KEY_NOTE,
  readRememberedPostingKeyCandidate,
} from '@/lib/vault/migration';
import { createVaultManager, type VaultManagerExtended } from '@/lib/vault/manager';
import { VAULT_DB_NAME, openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import type { VaultRecordV1 } from '@/lib/vault/types';
import { validateVaultWif } from '@/lib/vault/validation';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');
// Captured while narrowed so closures below see plain values.
const ACTIVE_WIF = active.privateKey;
const ACTIVE_IV = active.iv;
const ACTIVE_CIPHERTEXT = active.ciphertext;
const POSTING_IV = posting.iv;
const POSTING_CIPHERTEXT = posting.ciphertext;

const TARGET_PASSWORD = v.password;
const WRONG_PASSWORD = 'not-the-fixture-password';
const ACCOUNT = 'alice';

/** The mock-derived public key of a WIF ('STM' + last 8 chars). */
const publicKeyOf = (wif: string): string => validateVaultWif(wif, ACCOUNT).publicKey;

let fakeClock = 1_700_400_000_000;

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
  expect(caught).toBeInstanceOf(VaultError);
  expect((caught as VaultError).code).toBe(code);
}

/**
 * Registry wrapper that can tamper with getRecord results for the TARGET
 * vault's POST-WRITE reads: when a record comes back at revision >= 1 (the
 * migration's own write just landed), the newest posting ciphertext is
 * corrupted ('corrupt' — appended bytes, GCM auth must fail) or re-encrypted
 * from the ACTIVE fixture WIF under the SAME entry IV and vault password
 * while keeping the entry's outer publicKey ('swap' — authentic decrypt
 * succeeds but derives the WRONG public key). Everything else passes
 * through untouched.
 */
function makeTamperRegistry(
  base: VaultRegistry,
  vaultName: string,
): { registry: VaultRegistry; setMode: (mode: 'corrupt' | 'swap' | null) => void } {
  let mode: 'corrupt' | 'swap' | null = null;
  return {
    registry: {
      ...base,
      async getRecord(name: string) {
        const record = await base.getRecord(name);
        if (record === null || mode === null || name !== vaultName) return record;
        if (record.revision < 1) return record;
        const tampered = structuredClone(record);
        for (const account of tampered.accounts) {
          if (account.keys.posting.length === 0) continue;
          const entry = account.keys.posting[account.keys.posting.length - 1];
          if (!entry) continue;
          if (mode === 'corrupt') {
            entry.ciphertext = `${entry.ciphertext}AAAA`;
          } else {
            const kek = await deriveVaultKek(TARGET_PASSWORD, decodeBase64Url(tampered.salt));
            try {
              const swapped = await encryptVaultKey(
                kek,
                decodeBase64Url(entry.iv),
                ACTIVE_WIF,
              );
              entry.ciphertext = encodeBase64Url(swapped);
            } finally {
              kek.fill(0);
            }
          }
        }
        return tampered;
      },
    } as VaultRegistry,
    setMode: (next: 'corrupt' | 'swap' | null) => {
      mode = next;
    },
  };
}

describe('migrateRememberedPostingKey (A6-T5 verified-readback deletion gate)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let manager: VaultManagerExtended;

  beforeEach(() => {
    fake = installFakeIndexedDB();
    localStorage.clear();
  });

  afterEach(() => {
    manager?.destroy();
    registry?.close();
    fake.uninstall();
    fake.reset();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Build the stack; `tamper` optionally wraps the registry (see above). */
  async function setup(
    tamperVault?: string,
  ): Promise<{
    registry: VaultRegistry;
    manager: VaultManagerExtended;
    tamper: ReturnType<typeof makeTamperRegistry> | null;
  }> {
    const raw = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('beta', { accounts: [] }));
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo'));
    let tamper: ReturnType<typeof makeTamperRegistry> | null = null;
    let effective: VaultRegistry = raw;
    if (tamperVault !== undefined) {
      tamper = makeTamperRegistry(raw, tamperVault);
      effective = tamper.registry;
    }
    registry = raw;
    manager = createVaultManager(effective);
    return { registry: raw, manager, tamper };
  }

  const seedRemembered = (wif: string, username: string = ACCOUNT) => {
    localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, wif);
    localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
  };

  const plaintextIntact = (): void => {
    expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(posting.privateKey);
  };

  const plaintextGone = (): void => {
    expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBeNull();
  };

  it('readRememberedPostingKeyCandidate returns public data only, null when nothing valid is remembered', () => {
    expect(readRememberedPostingKeyCandidate()).toBeNull();
    localStorage.setItem(REMEMBERED_USERNAME_KEY, ACCOUNT);
    expect(readRememberedPostingKeyCandidate()).toBeNull();
    seedRemembered(posting.privateKey);
    const candidate = readRememberedPostingKeyCandidate();
    expect(candidate).toEqual({
      accountName: ACCOUNT,
      publicKey: publicKeyOf(posting.privateKey),
    });
    // Malformed username -> unresolvable -> null (never throws).
    seedRemembered(posting.privateKey, 'not a valid account name!!');
    expect(readRememberedPostingKeyCandidate()).toBeNull();
  });

  it('success chain: write -> registry re-read -> verified decrypt -> THEN plaintext deleted; username stays', async () => {
    seedRemembered(posting.privateKey);
    const { manager, registry } = await setup();

    const result = await manager.migrateRememberedPostingKey({
      vaultName: 'beta',
      expectedAccountName: ACCOUNT,
      expectedPublicKey: publicKeyOf(posting.privateKey),
      password: TARGET_PASSWORD,
    });

    expect(result.outcome).toBe('migrated');
    // Deletion happened exactly once the gate passed.
    plaintextGone();
    // The remembered USERNAME is deliberately kept (public account name,
    // classic-login prefill) — pin the red line's "what stays" contract.
    expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBe(ACCOUNT);

    // The stored entry: posting role, fixture-note default, outer publicKey,
    // fresh IV (differs from every fixture IV), and it decrypts back to the
    // remembered WIF under the vault password.
    const record = await registry.getRecord('beta');
    expect(record).not.toBeNull();
    expect(record?.revision).toBe(1);
    const account = record?.accounts.find((a) => a.accountName === ACCOUNT);
    expect(account?.keys.posting).toHaveLength(1);
    const entry = account?.keys.posting[0];
    expect(entry?.note).toBe(MIGRATED_KEY_NOTE);
    expect(entry?.publicKey).toBe(publicKeyOf(posting.privateKey));
    expect([posting.iv, active.iv, v.reencryption.iv]).not.toContain(entry?.iv);
  }, 30000);

  it('alreadyPresent: duplicate key rides addKey dedupe no-op, readback still verifies, plaintext still deleted', async () => {
    // demo already stores the posting WIF as a LEGACY entry (no outer
    // publicKey) — the dedupe decrypt probe must recognize it, skip the
    // write, and the readback verification must still authenticate that
    // legacy entry before deleting the plaintext.
    seedRemembered(posting.privateKey);
    const { manager, registry } = await setup();

    const result = await manager.migrateRememberedPostingKey({
      vaultName: 'demo',
      expectedAccountName: ACCOUNT,
      expectedPublicKey: publicKeyOf(posting.privateKey),
      password: TARGET_PASSWORD,
    });

    expect(result.outcome).toBe('alreadyPresent');
    plaintextGone();
    expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBe(ACCOUNT);
    // No write happened: the record is untouched at revision 0.
    const record = await registry.getRecord('demo');
    expect(record?.revision).toBe(0);
    expect(record?.accounts[0]?.keys.posting).toHaveLength(1);
  }, 30000);

  it('wrong vault password: VAULT_PASSWORD_INVALID before any write, plaintext intact', async () => {
    seedRemembered(posting.privateKey);
    const { manager, registry } = await setup();

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'demo',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: WRONG_PASSWORD,
        }),
      'VAULT_PASSWORD_INVALID',
    );
    plaintextIntact();
    const record = await registry.getRecord('demo');
    expect(record?.revision).toBe(0);
  }, 30000);

  it('remembered key vanished before the run: VAULT_KEY_INVALID, no write', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, ACCOUNT);
    const { manager, registry } = await setup();

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    plaintextGone(); // nothing was there to begin with
    const record = await registry.getRecord('beta');
    expect(record?.revision).toBe(0);
    expect(record?.accounts).toHaveLength(0);
  }, 30000);

  it('remembered key changed since verification: VAULT_KEY_INVALID, no write, the (changed) plaintext survives', async () => {
    seedRemembered(active.privateKey); // swapped after the UI verified the posting key
    const { manager, registry } = await setup();

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(active.privateKey);
    const record = await registry.getRecord('beta');
    expect(record?.revision).toBe(0);
  }, 30000);

  it('DELETION GATE 1/2 — readback decrypt failure: no deletion, key stays in vault (partial state)', async () => {
    seedRemembered(posting.privateKey);
    const { manager, registry, tamper } = await setup('beta');
    tamper?.setMode('corrupt');

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    // Write success did NOT delete the plaintext.
    plaintextIntact();
    // ...and the write itself DID land: the documented partial state (key in
    // vault AND plaintext on device) that the idempotent re-run resolves.
    tamper?.setMode(null);
    const record = await registry.getRecord('beta');
    expect(record?.revision).toBe(1);
    expect(record?.accounts[0]?.keys.posting).toHaveLength(1);
  }, 30000);

  it('DELETION GATE 2/2 — derived public key mismatch at readback: no deletion', async () => {
    seedRemembered(posting.privateKey);
    const { manager, tamper } = await setup('beta');
    tamper?.setMode('swap');

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    plaintextIntact();
  }, 30000);

  it('idempotent re-run after a partial success: dedupe no-op -> alreadyPresent -> verified -> plaintext deleted', async () => {
    seedRemembered(posting.privateKey);
    const { manager, tamper } = await setup('beta');

    // First run fails at the readback (corrupted re-read).
    tamper?.setMode('corrupt');
    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    plaintextIntact();

    // Second run: the key is already stored (outer publicKey present, plain
    // string dedupe — no decrypt probe needed), the re-read is clean now.
    tamper?.setMode(null);
    const result = await manager.migrateRememberedPostingKey({
      vaultName: 'beta',
      expectedAccountName: ACCOUNT,
      expectedPublicKey: publicKeyOf(posting.privateKey),
      password: TARGET_PASSWORD,
    });
    expect(result.outcome).toBe('alreadyPresent');
    plaintextGone();
  }, 60000);

  // -------------------------------------------------------------------------
  // Empty-target anchoring (review r1 P1-1)
  // -------------------------------------------------------------------------

  it('ANCHORING: a weak password into an EMPTY vault is rejected before any write', async () => {
    seedRemembered(posting.privateKey);
    const { manager, registry } = await setup();

    // Too short for the creation policy (14+ code points) — and an empty
    // vault would silently anchor it as THE vault password right before the
    // migration deletes the only other copy of the key.
    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: 'short',
        }),
      'VAULT_PASSWORD_WEAK',
    );
    plaintextIntact();
    const record = await registry.getRecord('beta');
    expect(record?.revision).toBe(0);
    expect(record?.accounts).toHaveLength(0);
  }, 30000);

  it('ANCHORING: the account name is not accepted as the anchoring password (policy context)', async () => {
    // A 15-char account name doubles as a length-passing password; only the
    // policy's account-name context rule rejects it.
    const longAccount = 'blocktrades-com';
    seedRemembered(posting.privateKey, longAccount);
    const { manager } = await setup();

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'beta',
          expectedAccountName: longAccount,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: longAccount,
        }),
      'VAULT_PASSWORD_WEAK',
    );
    plaintextIntact();
  }, 30000);

  it('ANCHORING: a policy-valid password still migrates into an empty vault (and anchors it)', async () => {
    seedRemembered(posting.privateKey);
    const { manager } = await setup();

    const result = await manager.migrateRememberedPostingKey({
      vaultName: 'beta',
      expectedAccountName: ACCOUNT,
      expectedPublicKey: publicKeyOf(posting.privateKey),
      password: TARGET_PASSWORD,
    });
    expect(result.outcome).toBe('migrated');
    plaintextGone();
  }, 30000);

  it('ANCHORING does not apply to a non-empty vault: the existing password keeps working (no policy re-run)', async () => {
    seedRemembered(posting.privateKey);
    const { manager } = await setup();
    // 'demo' already holds keys under TARGET_PASSWORD; the policy never runs
    // for non-empty targets (unlock-path passwords must keep working).
    const result = await manager.migrateRememberedPostingKey({
      vaultName: 'demo',
      expectedAccountName: ACCOUNT,
      expectedPublicKey: publicKeyOf(posting.privateKey),
      password: TARGET_PASSWORD,
    });
    expect(result.outcome).toBe('alreadyPresent');
    plaintextGone();
  }, 30000);

  // -------------------------------------------------------------------------
  // Unpinned alreadyPresent readback (review r1 P1-2)
  // -------------------------------------------------------------------------

  it('alreadyPresent is NOT trusted: a stored entry that string-matches the outer publicKey but cannot decrypt throws, plaintext survives', async () => {
    seedRemembered(posting.privateKey);
    // A revision-1 vault whose alice posting entry carries the MATCHING
    // outer publicKey (so service.addKey dedupes by plain string comparison
    // and never decrypts) but CORRUPTED ciphertext; the valid ACTIVE entry
    // lets addKey's authenticate() pass. A migration that skipped the
    // readback for the no-op outcome would delete the plaintext while the
    // stored entry is garbage — exactly what this test kills.
    const { manager, registry } = await setup();
    fake.seed(
      VAULT_DB_NAME,
      'vaults',
      makeRecord('dedupe-corrupt', {
        revision: 1,
        accounts: [
          {
            accountName: ACCOUNT,
            keys: {
              owner: [],
              active: [
                {
                  iv: ACTIVE_IV,
                  ciphertext: ACTIVE_CIPHERTEXT,
                  note: 'authenticate anchor',
                },
              ],
              posting: [
                {
                  iv: POSTING_IV,
                  ciphertext: `${POSTING_CIPHERTEXT}AAAA`,
                  note: 'corrupted duplicate',
                  publicKey: publicKeyOf(posting.privateKey),
                },
              ],
              memo: [],
            },
          },
        ],
      }),
    );

    await expectRejectedBy(
      () =>
        manager.migrateRememberedPostingKey({
          vaultName: 'dedupe-corrupt',
          expectedAccountName: ACCOUNT,
          expectedPublicKey: publicKeyOf(posting.privateKey),
          password: TARGET_PASSWORD,
        }),
      'VAULT_KEY_INVALID',
    );
    plaintextIntact();
    // The stored record is untouched by the failed run.
    const record = await registry.getRecord('dedupe-corrupt');
    expect(record?.revision).toBe(1);
    expect(record?.accounts[0]?.keys.posting[0]?.publicKey).toBe(
      publicKeyOf(posting.privateKey),
    );
  }, 30000);

  // -------------------------------------------------------------------------
  // Deletion-point hardening (review r1 P2 + P3-1)
  // -------------------------------------------------------------------------

  it('TOCTOU: a mid-flow swap of the remembered plaintext aborts with no deletion', async () => {
    seedRemembered(posting.privateKey);
    const { manager } = await setup();

    // The SECOND read of the remembered posting key inside the flow (the
    // first is readRememberedPair's, the second is the deletion-point
    // still-current check) returns a different WIF — another tab or a login
    // swapped it between the verified readback and the deletion.
    const realGetItem = Storage.prototype.getItem;
    let postingKeyReads = 0;
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(function (this: Storage, key: string) {
        if (key === REMEMBERED_POSTING_KEY_KEY) {
          postingKeyReads += 1;
          if (postingKeyReads === 2) return '5Jswapped-mid-flow-key';
        }
        return realGetItem.call(this, key) as string | null;
      });

    try {
      await expectRejectedBy(
        () =>
          manager.migrateRememberedPostingKey({
            vaultName: 'demo',
            expectedAccountName: ACCOUNT,
            expectedPublicKey: publicKeyOf(posting.privateKey),
            password: TARGET_PASSWORD,
          }),
        'VAULT_KEY_INVALID',
      );
    } finally {
      spy.mockRestore();
    }
    // The (real) plaintext survived.
    plaintextIntact();
  }, 30000);

  it('deletion post-condition: a swallowed removeItem storage error surfaces as failure, never as success', async () => {
    seedRemembered(posting.privateKey);
    const { manager, registry } = await setup();

    // removeItem swallowed (clearRememberedPostingKey ignores errors) — the
    // post-condition read must catch the surviving plaintext.
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

    try {
      await expectRejectedBy(
        () =>
          manager.migrateRememberedPostingKey({
            vaultName: 'beta',
            expectedAccountName: ACCOUNT,
            expectedPublicKey: publicKeyOf(posting.privateKey),
            password: TARGET_PASSWORD,
          }),
        'VAULT_STORAGE_UNAVAILABLE',
      );
    } finally {
      removeSpy.mockRestore();
    }
    // The plaintext is still on the device — the UI must NOT have seen a
    // success (the documented re-runnable partial state; the vault copy is
    // verified in the record).
    plaintextIntact();
    const record = await registry.getRecord('beta');
    expect(record?.accounts[0]?.keys.posting).toHaveLength(1);
  }, 30000);
});
