// Vault backup export / independent import / merge migration tests (A3).
// Storage runs on the hand-written fake IndexedDB (tests/mocks/fake-indexeddb.ts
// — read its FIDELITY BOUNDARY header before trusting concurrency cases) and
// source backups are REAL envelopes: fixture password/salt plus AES-GCM
// encryptions of the fixture payload variants, sealed once in beforeAll.
//
// WIF→public-key derivation runs through the shared validateVaultWif entry
// point, which under vitest is driven by tests/mocks/steem-js.ts (fake
// getPublicKey: 'STM' + last 8 chars; isWif overridable per call). WIF cases
// here prove branches/error codes ONLY, per the A1.1 two-layer rule — real
// checksum/derivation evidence lives in tests/node/vault-wif-real-check.mjs
// (rerun for this PR; see the PR body).
//
// ORDER INDEPENDENCE: every test rebuilds its own fake database and registry
// in beforeEach (records re-seeded from beforeAll envelope material) and
// destroys its services — shuffle- and single-test safe (A2 standard).
//
// Performance: PBKDF2 600k costs ~0.5-0.8s per derivation. Exactly TWO are
// paid in beforeAll (the fixture KEK shared by all sealed envelopes + the
// weak-password KEK); each test then pays only for the derivations its own
// calls perform. Whole-file budget: 24 derivations (import success 4, the
// import rollback case 2, eight single-derivation import failure cases, merge
// success 2, two combined merge-failure tests 3 each) — measured ~16s of test
// time. Per-test budgets are noted in test headers where > 0. Failure
// scenarios that share an unlocked target deliberately SHARE the unlock
// derivation.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  decryptVaultText,
  deriveVaultKek,
  encryptVaultText,
  generateVaultIv,
} from '@/lib/vault/crypto';
import {
  decodeBase64Url,
  encodeBase64Url,
  parseVaultEnvelopeJson,
  validateVaultPayloadText,
} from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import {
  exportVaultBackup,
  importVaultBackup,
  mergeVaultBackup,
  type VaultMergeResult,
} from '@/lib/vault/backup';
import {
  VAULT_DB_NAME,
  openVaultRegistry,
  type VaultRegistry,
} from '@/lib/vault/registry';
import { createVaultService } from '@/lib/vault/service';
import type { VaultEnvelopeV1, VaultKeyEntry, VaultRecordV1 } from '@/lib/vault/types';

const v = vectors.vault;

// Test WIFs: the fixture WIF plus PUBLIC TEST-ONLY strings (never real keys).
const BOB_WIF = '5Ktest-wif-bob-0001';
const CAROL_WIF = '5Ktest-wif-carol-01';
const BAD_WIF = 'totally-not-a-wif';
// 29 code points — passes the length floor, hits the common-password
// blocklist, so the weak-import case exercises the policy itself (the short
// 'password' path is the length branch, covered in vault-validation tests).
const WEAK_PASSWORD = 'correct horse battery staple';

const fixtureKeys = validateVaultPayloadText(v.payloadText).keys;
const aliceEntry: VaultKeyEntry | undefined = fixtureKeys[0];
if (!aliceEntry) {
  throw new Error('fixture payload has no key entry');
}
const aliceWif = aliceEntry.privateKey;

function entry(accountName: string, role: VaultKeyEntry['role'], privateKey: string): VaultKeyEntry {
  return { accountName, role, privateKey };
}
const keysText = (keys: VaultKeyEntry[]): string => JSON.stringify({ keys });

/** Distinct mock public keys need distinct WIF tails — padded counters guarantee that. */
const numberedWif = (prefix: string, i: number): string => `${prefix}-${String(i).padStart(3, '0')}`;

// Envelope material sealed once in beforeAll (AES-GCM only after the two
// shared derivations — see the header).
let sharedKek: Uint8Array<ArrayBuffer>;
let weakKek: Uint8Array<ArrayBuffer>;
let weakEnvelope: VaultEnvelopeV1;
let dupEnvelope: VaultEnvelopeV1;
let badWifEnvelope: VaultEnvelopeV1;
let badAccountEnvelope: VaultEnvelopeV1;
let keys401Envelope: VaultEnvelopeV1;
let accounts101Envelope: VaultEnvelopeV1;
let oversizedEnvelope: VaultEnvelopeV1;
let source400Envelope: VaultEnvelopeV1;
let mergeSourceEnvelope: VaultEnvelopeV1;
let targetEnvelope: VaultEnvelopeV1;

/** Seal a payload under a given KEK with a fresh IV and the fixture salt. */
async function seal(
  payloadText: string,
  kek: Uint8Array<ArrayBuffer>,
  vaultName: string,
): Promise<VaultEnvelopeV1> {
  const iv = generateVaultIv();
  const ciphertext = await encryptVaultText(kek, iv, payloadText);
  return {
    version: 1,
    vaultName,
    salt: v.salt,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

let fakeClock = 1_700_200_000_000;

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

/** Markers that must never appear in a public result or an error message. */
function expectClean(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const secrets = [
    aliceWif,
    BOB_WIF,
    CAROL_WIF,
    BAD_WIF,
    v.password,
    WEAK_PASSWORD,
    v.kekHex.slice(0, 32),
    v.payloadText.slice(0, 24),
  ];
  for (const secret of secrets) {
    expect(text).not.toContain(secret);
  }
}

/** Assert a synchronous throw is a VaultError with the given code. */
function expectVaultError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected a VaultError with code ${code}`).toBeInstanceOf(VaultError);
  expect((caught as VaultError).code).toBe(code);
}

describe('vault backup (A3)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;

  beforeAll(async () => {
    sharedKek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    weakKek = await deriveVaultKek(WEAK_PASSWORD, decodeBase64Url(v.salt));

    // Weak-password source: decrypts fine under a policy-failing password.
    weakEnvelope = await seal(v.payloadText, weakKek, 'weak-source');
    // Duplicate entries inside the source (case variant + exact repeat).
    dupEnvelope = await seal(
      keysText([
        entry('alice', 'posting', aliceWif),
        entry('Alice', 'posting', aliceWif), // normalizes onto the first entry
        entry('bob', 'active', BOB_WIF),
      ]),
      sharedKek,
      'dup-source',
    );
    badWifEnvelope = await seal(
      keysText([entry('alice', 'posting', BAD_WIF)]),
      sharedKek,
      'bad-wif-source',
    );
    badAccountEnvelope = await seal(
      keysText([entry('x', 'posting', aliceWif)]), // 'x' fails the account-name format
      sharedKek,
      'bad-account-source',
    );
    // 401 distinct keys across 100 accounts (i and i+400 share account+role
    // but differ in WIF → distinct mock public keys → no dedupe collapse).
    keys401Envelope = await seal(
      keysText(
        Array.from({ length: 401 }, (_, i) =>
          entry(
            `acct${i % 100}`,
            (['owner', 'active', 'posting', 'memo'] as const)[i % 4] ?? 'posting',
            numberedWif('5Kkey', i),
          ),
        ),
      ),
      sharedKek,
      'keys401-source',
    );
    // 101 entries on 101 distinct accounts (keys stay under 400).
    accounts101Envelope = await seal(
      keysText(
        Array.from({ length: 101 }, (_, i) => entry(`acct${i}`, 'posting', numberedWif('5Kacc', i))),
      ),
      sharedKek,
      'accounts101-source',
    );
    // A REAL plaintext one byte over the decrypted-payload cap. Its ciphertext
    // (cap + 17 bytes) necessarily exceeds the envelope ciphertext cap too —
    // through an import the outer cap fires first with the SAME code, by
    // design (payload cap = ciphertext cap − GCM tag); the payload-layer
    // rejection is asserted directly below and the byte cap is exercised for
    // real on the in-memory merge path.
    const OVERSIZE_BYTES = 1024 * 1024 - 16 + 1;
    const head = '{"keys":[{"accountName":"alice","role":"posting","privateKey":"';
    const tail = '"}]}';
    const oversizeText = head + 'x'.repeat(OVERSIZE_BYTES - head.length - tail.length) + tail;
    expect(oversizeText.length).toBe(OVERSIZE_BYTES); // pure ASCII → length === UTF-8 bytes
    oversizedEnvelope = await seal(oversizeText, sharedKek, 'oversize-source');
    // 400 distinct keys on 100 accounts — source for the merge over-limit case
    // (target already holds 1 key → merged 401).
    source400Envelope = await seal(
      keysText(
        Array.from({ length: 400 }, (_, i) =>
          entry(
            `acct${i % 100}`,
            (['owner', 'active', 'posting', 'memo'] as const)[i % 4] ?? 'posting',
            numberedWif('5Ksrc', i),
          ),
        ),
      ),
      sharedKek,
      'source400',
    );
    // Carol (new) + an alice entry colliding with the target's key.
    mergeSourceEnvelope = await seal(
      keysText([entry('carol', 'active', CAROL_WIF), entry('alice', 'posting', aliceWif)]),
      sharedKek,
      'merge-source',
    );
    // The merge TARGET: the same key as the fixture payload but stored with a
    // NON-normalized account spelling (makes target-priority observable), plus
    // an exact internal duplicate (exercises the target-side dedupe collapse).
    targetEnvelope = await seal(
      keysText([entry('Alice', 'posting', aliceWif), entry('alice', 'posting', aliceWif)]),
      sharedKek,
      'Target',
    );
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo', v));
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('Target', targetEnvelope));
  });

  afterEach(() => {
    registry.close();
    fake.uninstall();
    fake.reset();
    // Restore the steem-js mock defaults regardless of per-test overrides.
    vi.mocked(steem.auth.isWif).mockReset();
    vi.mocked(steem.auth.isWif).mockReturnValue(true);
    vi.mocked(steem.auth.getPublicKey).mockReset();
    vi.mocked(steem.auth.getPublicKey).mockImplementation((wif: string) =>
      wif ? 'STM' + wif.slice(-8) : 'STM',
    );
  });

  const currentRecord = async (name: string): Promise<VaultRecordV1> => {
    const record = await registry.getRecord(name);
    if (!record) {
      throw new Error(`record ${name} disappeared`);
    }
    return record;
  };

  const vaultNames = async (): Promise<string[]> =>
    (await registry.listRecords()).map((record) => record.vaultName);

  describe('exportVaultBackup', () => {
    it('exports EXACTLY the five envelope fields, updates lastBackupAt via CAS, never touches crypto material', async () => {
      const before = await currentRecord('demo');
      const backup = await exportVaultBackup(registry, 'demo');
      // Exactly five fields — no revision/lockEpoch/timestamps.
      expect(Object.keys(backup).sort()).toEqual(['ciphertext', 'iv', 'salt', 'vaultName', 'version']);
      expect(backup).toEqual({
        version: 1,
        vaultName: 'demo',
        salt: before.salt,
        iv: before.iv,
        ciphertext: before.ciphertext,
      });
      // Read-only crypto: salt/IV/ciphertext byte-identical; only the backup
      // marker moved (plus the revision +1 the swapRecord contract mandates).
      const after = await currentRecord('demo');
      expect(after.salt).toBe(before.salt);
      expect(after.iv).toBe(before.iv);
      expect(after.ciphertext).toBe(before.ciphertext);
      expect(after.revision).toBe(before.revision + 1);
      expect(after.lockEpoch).toBe(before.lockEpoch);
      expect(after.lastBackupAt).not.toBeNull();
      expect(typeof after.lastBackupAt).toBe('number');
      expectClean(backup);
    });

    it('rejects with VAULT_NOT_FOUND for an unknown vault', async () => {
      await expect(exportVaultBackup(registry, 'ghost')).rejects.toMatchObject({
        code: 'VAULT_NOT_FOUND',
      });
    });

    it('propagates VAULT_SESSION_STALE when the record moves between read and CAS, leaving lastBackupAt untouched', async () => {
      const before = await currentRecord('demo');
      const racing: VaultRegistry = {
        ...registry,
        getRecord: async (name: string) => {
          const record = await registry.getRecord(name);
          if (record !== null && name === 'demo') {
            // Concurrent lock lands AFTER the export's read but BEFORE its CAS.
            await registry.bumpLockEpoch('demo');
          }
          return record;
        },
      };
      await expect(exportVaultBackup(racing, 'demo')).rejects.toMatchObject({
        code: 'VAULT_SESSION_STALE',
      });
      const after = await currentRecord('demo');
      expect(after.lastBackupAt).toBeNull(); // the swap never happened
      expect(after.ciphertext).toBe(before.ciphertext);
      expect(after.iv).toBe(before.iv);
      expect(after.salt).toBe(before.salt);
      expect(after.revision).toBe(before.revision);
      expect(after.lockEpoch).toBe(before.lockEpoch + 1); // the injected bump only
    });
  });

  describe('importVaultBackup (independent)', () => {
    // 4 derivations: source decrypt + createVault + in-scope unlock + verify.
    it('creates a new vault: fresh salt/IV, re-encrypted normalized payload, no activation', async () => {
      const result = await importVaultBackup(registry, {
        mode: 'independent',
        envelope: dupEnvelope,
        password: v.password,
        vaultName: 'Imported',
      });
      expect(result.vaultName).toBe('Imported');
      expect(result.revision).toBe(1); // create (0) + the payload write (1)
      expect(result.lastBackupAt).toBeNull();
      expect(result.salt).not.toBe(dupEnvelope.salt);
      expect(result.iv).not.toBe(dupEnvelope.iv);
      expect(result.ciphertext).not.toBe(dupEnvelope.ciphertext);
      // Single-password contract: the SAME password unlocks the new vault, and
      // the payload is exactly the normalized, deduplicated source payload.
      const newKek = await deriveVaultKek(v.password, decodeBase64Url(result.salt));
      const payloadText = await decryptVaultText(
        newKek,
        decodeBase64Url(result.iv),
        decodeBase64Url(result.ciphertext),
      );
      expect(payloadText).toBe(
        keysText([entry('alice', 'posting', aliceWif), entry('bob', 'active', BOB_WIF)]),
      );
      // Not activated — settings untouched.
      await expect(registry.getSettings()).resolves.toEqual({
        schemaVersion: 1,
        signingMode: 'privateKey',
        activeVaultName: null,
      });
      expect(await vaultNames()).toEqual(['demo', 'Imported', 'Target']);
      expectClean(result);
    }, 30000);

    // 1 derivation (source decrypts, then the policy fires).
    it('rejects a policy-failing password with VAULT_PASSWORD_WEAK and creates nothing', async () => {
      const error: unknown = await importVaultBackup(registry, {
        mode: 'independent',
        envelope: weakEnvelope,
        password: WEAK_PASSWORD,
        vaultName: 'Weak',
      }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'VAULT_PASSWORD_WEAK' });
      expectClean((error as Error).message);
      expect(await vaultNames()).toEqual(['demo', 'Target']);
      await expect(registry.getSettings()).resolves.toMatchObject({ activeVaultName: null });
    }, 20000);

    // 1 derivation (the wrong KEK attempt itself).
    it('rejects a wrong source password with VAULT_PASSWORD_INVALID and creates nothing', async () => {
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: dupEnvelope,
          password: 'wrong-password-123456',
          vaultName: 'Nope',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    it('rejects malformed envelopes with VAULT_ENVELOPE_INVALID before any crypto or write', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ['unknown version', { ...dupEnvelope, version: 2 }],
        ['missing ciphertext field', (() => {
          const broken: Record<string, unknown> = { ...dupEnvelope };
          delete broken['ciphertext'];
          return broken;
        })()],
        ['non-canonical salt (trailing-bit alias)', { ...dupEnvelope, salt: 'AAECAwQFBgcICQoLDA0ODx' }],
        ['extra sixth field', { ...dupEnvelope, revision: 0 }],
      ];
      for (const [label, envelope] of cases) {
        await expect(
          importVaultBackup(registry, {
            mode: 'independent',
            envelope: envelope as unknown as VaultEnvelopeV1,
            password: v.password,
            vaultName: 'X',
          }),
          label,
        ).rejects.toMatchObject({ code: 'VAULT_ENVELOPE_INVALID' });
      }
      // Invalid ROLE: the shared payload validator (the import pipeline's
      // step 2, before any per-entry WIF check) owns role legality and rejects
      // with VAULT_PAYLOAD_INVALID — the kickoff assigns VAULT_KEY_INVALID to
      // WIF/public-key/account failures only. Zero-derivation assertion: the
      // validator is what the import path calls on the decrypted text.
      expectVaultError(
        () =>
          validateVaultPayloadText(
            keysText([entry('alice', 'superuser' as VaultKeyEntry['role'], aliceWif)]),
          ),
        'VAULT_PAYLOAD_INVALID',
      );
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    });

    it('rejects raw backup JSON beyond 1 MiB with VAULT_LIMIT_EXCEEDED at the parse gate', async () => {
      // importVaultBackup takes the parsed envelope object (A0 contract); the
      // raw-JSON text gate (A4/A5 callers compose it before this call) is
      // parseVaultEnvelopeJson — same shared constants, enforced before
      // JSON.parse and long before any write.
      const raw = JSON.stringify(dupEnvelope).slice(0, -1) + ',"pad":"' + 'A'.repeat(1024 * 1024) + '"}';
      expectVaultError(() => parseVaultEnvelopeJson(raw), 'VAULT_LIMIT_EXCEEDED');
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    });

    it('rejects oversized ciphertext and oversized plaintext with VAULT_LIMIT_EXCEEDED before any write', async () => {
      // Encoded-length pre-check: 1398103 chars > the 1398102 cap.
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: { ...dupEnvelope, ciphertext: 'A'.repeat(1398103) },
          password: v.password,
          vaultName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      // A REAL over-cap plaintext source (one byte past the payload cap): its
      // ciphertext necessarily trips the tighter envelope cap first — same
      // code. Prove the plaintext genuinely exceeds the payload bound.
      const text = await decryptVaultText(
        sharedKek,
        decodeBase64Url(oversizedEnvelope.iv),
        decodeBase64Url(oversizedEnvelope.ciphertext),
      );
      expect(text.length).toBe(1024 * 1024 - 15);
      expectVaultError(() => validateVaultPayloadText(text), 'VAULT_LIMIT_EXCEEDED');
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: oversizedEnvelope,
          password: v.password,
          vaultName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    });

    // 1 derivation each (decrypt succeeds, then the payload bound fires).
    it('rejects 401 source keys with VAULT_LIMIT_EXCEEDED and creates nothing', async () => {
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: keys401Envelope,
          password: v.password,
          vaultName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    it('rejects 101 distinct source accounts with VAULT_LIMIT_EXCEEDED and creates nothing', async () => {
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: accounts101Envelope,
          password: v.password,
          vaultName: 'X',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    // 1 derivation each (mock-driven WIF branch — real checks live in the
    // plain-Node script; see the file header).
    it('rejects an invalid source WIF with VAULT_KEY_INVALID (mock-driven), no echo, nothing created', async () => {
      vi.mocked(steem.auth.isWif).mockReturnValueOnce(false);
      const error: unknown = await importVaultBackup(registry, {
        mode: 'independent',
        envelope: badWifEnvelope,
        password: v.password,
        vaultName: 'X',
      }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expectClean((error as Error).message);
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    it('rejects an invalid source account name with VAULT_KEY_INVALID (real normalization path)', async () => {
      const error: unknown = await importVaultBackup(registry, {
        mode: 'independent',
        envelope: badAccountEnvelope,
        password: v.password,
        vaultName: 'X',
      }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expectClean((error as Error).message);
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    // 1 derivation each (name errors surface from the registry transaction).
    it('routes a colliding new name to VAULT_NAME_EXISTS and leaves the existing vault intact', async () => {
      const before = await currentRecord('demo');
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: dupEnvelope,
          password: v.password,
          vaultName: 'Demo', // case-fold collision with the seeded 'demo'
        }),
      ).rejects.toMatchObject({ code: 'VAULT_NAME_EXISTS' });
      expect(await currentRecord('demo')).toEqual(before);
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    it('routes an invalid new name to VAULT_NAME_INVALID and creates nothing', async () => {
      await expect(
        importVaultBackup(registry, {
          mode: 'independent',
          envelope: dupEnvelope,
          password: v.password,
          vaultName: ' leading-space',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_NAME_INVALID' });
      expect(await vaultNames()).toEqual(['demo', 'Target']);
    }, 20000);

    // 2 derivations: source decrypt + createVault; the in-scope unlock then
    // fails cheaply (the wrapper hides the just-created record from unlock's
    // FIRST read, before any crypto) — same rollback path as a CAS failure.
    it('a failure after the create rolls the whole import back — no empty vault left behind', async () => {
      const failing: VaultRegistry = {
        ...registry,
        getRecord: async (name: string) =>
          name === 'Imported' ? null : registry.getRecord(name),
      };
      const error: unknown = await importVaultBackup(failing, {
        mode: 'independent',
        envelope: dupEnvelope,
        password: v.password,
        vaultName: 'Imported',
      }).catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'VAULT_NOT_FOUND' });
      expectClean((error as Error).message);
      // The just-created vault was removed again — a failed import leaves no
      // trace (kickoff A3 completion criterion): without the rollback the
      // name list would contain an empty 'Imported' vault.
      expect(await vaultNames()).toEqual(['demo', 'Target']);
      await expect(registry.getSettings()).resolves.toMatchObject({ activeVaultName: null });
    }, 30000);
  });

  describe('mergeVaultBackup', () => {
    // 2 derivations: target unlock + source decrypt.
    it('merges into the unlocked target: union, target-priority dedupe, fresh IV, alias and lastBackupAt unchanged', async () => {
      const service = createVaultService(registry);
      const before = await currentRecord('Target');
      await service.unlock('Target', v.password);
      const result: VaultMergeResult = await mergeVaultBackup(registry, service, {
        mode: 'merge',
        envelope: mergeSourceEnvelope,
        password: v.password,
        targetVaultName: 'Target',
      });
      expect(result.status).toMatchObject({
        locked: false,
        vaultName: 'Target',
        revision: before.revision + 1,
      });
      // Safety net: the pre-merge five-field envelope, byte-identical to the
      // stored fields — and NOT persisted (lastBackupAt stays null below).
      expect(result.preMergeBackup).toEqual({
        version: 1,
        vaultName: 'Target',
        salt: before.salt,
        iv: before.iv,
        ciphertext: before.ciphertext,
      });
      const after = await currentRecord('Target');
      expect(after.vaultName).toBe('Target'); // alias unchanged
      expect(after.salt).toBe(before.salt); // salt belongs to password changes
      expect(after.iv).not.toBe(before.iv); // whole-payload re-encryption
      expect(after.ciphertext).not.toBe(before.ciphertext);
      expect(after.lastBackupAt).toBeNull();
      // Target entry first with its RAW spelling (priority), source-only
      // carol appended (normalized) — decryptable under the TARGET password.
      const payloadText = await decryptVaultText(
        sharedKek,
        decodeBase64Url(after.iv),
        decodeBase64Url(after.ciphertext),
      );
      expect(payloadText).toBe(
        keysText([entry('Alice', 'posting', aliceWif), entry('carol', 'active', CAROL_WIF)]),
      );
      // The session adopted the merged payload; no activation happened.
      const accounts = await service.getAccounts();
      expect(accounts.map((account) => account.accountName)).toEqual(['alice', 'carol']);
      await expect(registry.getSettings()).resolves.toMatchObject({ activeVaultName: null });
      // Name gate (rides on this test's already-paid unlock): a session on
      // 'Target' does not satisfy a merge request for a DIFFERENT vault name.
      await expect(
        mergeVaultBackup(registry, service, {
          mode: 'merge',
          envelope: mergeSourceEnvelope,
          password: v.password,
          targetVaultName: 'demo',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      expectClean(result);
      service.destroy();
    }, 30000);

    it('rejects with VAULT_LOCKED when the target is not unlocked in the service', async () => {
      const service = createVaultService(registry);
      const before = await currentRecord('Target');
      await expect(
        mergeVaultBackup(registry, service, {
          mode: 'merge',
          envelope: mergeSourceEnvelope,
          password: v.password,
          targetVaultName: 'Target',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
      expect(await currentRecord('Target')).toEqual(before);
      service.destroy();
    });

    // 3 derivations: one shared target unlock + one derivation per failing
    // source open (wrong password / invalid entry). Both reject BEFORE any
    // write attempt, so the target record stays byte-identical.
    it('source-side failures (wrong password, invalid entry) leave the target record byte-identical', async () => {
      const service = createVaultService(registry);
      const before = await currentRecord('Target');
      await service.unlock('Target', v.password);
      const wrongPassword: unknown = await mergeVaultBackup(registry, service, {
        mode: 'merge',
        envelope: mergeSourceEnvelope,
        password: 'wrong-password-123456',
        targetVaultName: 'Target',
      }).catch((cause: unknown) => cause);
      expect(wrongPassword).toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
      expectClean((wrongPassword as Error).message);
      expect(await currentRecord('Target')).toEqual(before);
      const invalidEntry: unknown = await mergeVaultBackup(registry, service, {
        mode: 'merge',
        envelope: badAccountEnvelope,
        password: v.password,
        targetVaultName: 'Target',
      }).catch((cause: unknown) => cause);
      expect(invalidEntry).toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expectClean((invalidEntry as Error).message);
      expect(await currentRecord('Target')).toEqual(before);
      service.destroy();
    }, 30000);

    // 3 derivations: one shared target unlock + one per merge attempt. Runs
    // over a registry whose CAS always reports a concurrent change — the
    // over-limit attempt provably never reaches the CAS (it dies in mutatePayload
    // validation), the second attempt dies AT the CAS.
    it('write-side failures (over-limit result, CAS staleness) keep the target untouched', async () => {
      const failing: VaultRegistry = {
        ...registry,
        swapRecord: () =>
          Promise.reject(
            new VaultError('VAULT_SESSION_STALE', 'injected concurrent change'),
          ),
      };
      const service = createVaultService(failing);
      const before = await currentRecord('Target');
      await service.unlock('Target', v.password);
      await expect(
        mergeVaultBackup(failing, service, {
          mode: 'merge',
          envelope: source400Envelope, // 400 source keys + the target's 1 = 401
          password: v.password,
          targetVaultName: 'Target',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_LIMIT_EXCEEDED' });
      expect(await currentRecord('Target')).toEqual(before);
      // The session survives a validation failure at the pre-merge revision.
      await expect(service.getStatus()).resolves.toMatchObject({
        locked: false,
        vaultName: 'Target',
        revision: before.revision,
      });
      await expect(
        mergeVaultBackup(failing, service, {
          mode: 'merge',
          envelope: mergeSourceEnvelope,
          password: v.password,
          targetVaultName: 'Target',
        }),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      expect(await currentRecord('Target')).toEqual(before);
      // The stale session was cleared by the service.
      await expect(service.getStatus()).resolves.toMatchObject({ locked: true });
      service.destroy();
    }, 30000);
  });
});
