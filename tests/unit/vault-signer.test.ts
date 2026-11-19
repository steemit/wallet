// Vault signer tests (per-key hierarchy). Storage runs on the hand-written
// fake IndexedDB (tests/mocks/fake-indexeddb.ts — see its FIDELITY BOUNDARY
// header). Signing needs NO unlock: the vault is SELECTED (activateVault —
// a settings write, zero derivations) and each signing request carries the
// key IV pointer plus the vault password; the signer derives the KEK,
// decrypts EXACTLY the selected key, re-verifies the on-chain authority and
// cleans up (KEK zeroized, WIF dropped, request password scrubbed). One
// signing call = one PBKDF2 derivation (~0.5-0.8s). Whole-file budget: ~30
// derivations (beforeAll 1 + one per successful/failed-password signing
// call; classifier, selection and unsupported-operation cases derive
// nothing). Per-test timeouts accordingly.
//
// MOCK DISCIPLINE (two layers, per docs/AI-driver/08-testing.md and the A1.1
// ruling):
//   - '@/lib/steem/accounts-client' is vi.mock'ed: the authority precheck
//     branches (degraded / missing account / malformed authority / fetch
//     rejection) are contract tests of the signer against the response shape
//     the real route produces (`{ success, accounts, degraded? }` — shape
//     derived from src/app/api/query/accounts/route.ts, not invented).
//   - '@steemit/steem-js' is the global mock: `signTransaction` is a vi.fn
//     returning a canned payload — assertions on it prove the CALL CONTRACT
//     (which transaction object and which WIF reached the signer), never
//     signature authenticity. The transaction id, however, is computed via
//     the REAL proxied `serializeTransaction` + WebCrypto SHA-256, and the
//     frozen-transaction test pins the exact fixture vector
//     `07c1af89bc7bfbbe2b9261e0b6cb3bf231b98c4d` end-to-end.
//   - The transaction header is served by a stubbed global fetch (the
//     established pattern from tests/unit/steem-signer-real-ops.test.ts).
//
// WIF→public-key derivation runs through the shared validateVaultWif entry
// point (mock getPublicKey: 'STM' + last 8 chars of the WIF) — branch
// coverage only; real crypto evidence lives in tests/node/vault-wif-real-check.mjs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { steem } from '@steemit/steem-js';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { installFakeIndexedDB, type FakeIndexedDBHandle } from '../mocks/fake-indexeddb';
import {
  deriveVaultKek,
  encryptVaultKeyRecord,
} from '@/lib/vault/crypto';
import { decodeBase64Url } from '@/lib/vault/envelope';
import { createVaultManager, type VaultManagerExtended } from '@/lib/vault/manager';
import { createLegacyPrivateKeySigner } from '@/lib/auth/legacy-private-key-signer';
import { VAULT_DB_NAME, openVaultRegistry, type VaultRegistry } from '@/lib/vault/registry';
import { resolveRequiredAuthorityClass } from '@/lib/vault/signer';
import type {
  SignOperationsRequest,
  VaultAccountEntry,
  VaultRecordV1,
} from '@/lib/vault/types';
import type { SteemAccount } from '@/lib/steem/types';

// Established accounts-client mock pattern (see tests/unit/transfer-form-amount.test.tsx):
// the factory only closes over the fn — the reference resolves at call time.
const mockFetchAccounts = vi.fn();
vi.mock('@/lib/steem/accounts-client', () => ({
  fetchAccounts: (...args: unknown[]) => mockFetchAccounts(...(args as [string[], { fresh?: boolean }])),
}));

const v = vectors.vault;
const posting = v.keys[0];
const active = v.keys[1];
if (!posting || !active) throw new Error('fixture needs two keys');
const aliceWif = posting.privateKey;
// The vitest mock derives 'STM' + the last 8 characters of the WIF.
const alicePublicKey = `STM${aliceWif.slice(-8)}`;
const activePublicKey = `STM${active.privateKey.slice(-8)}`;
const ALICE_MEMO_WIF = '5Ktest-wif-alice-memo';
const aliceMemoPublicKey = `STM${ALICE_MEMO_WIF.slice(-8)}`;
const OTHER_POSTING_KEY = 'STMotherPostingKey0000';

// One header response for every signing case (shape copied from
// /api/query/transaction-header — same source as the real-ops guard test).
const TRANSACTION_HEADER = {
  success: true,
  ref_block_num: 99,
  ref_block_prefix: 3704360964,
  expiration: '2030-01-01T12:00:00',
};

let fakeClock = 1_700_200_000_000;

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

/** Authority block as condenser_api returns it (fc::flat_map tuple JSON). */
function authority(keyAuths: Array<[string, number]>, weightThreshold = 1) {
  return {
    weight_threshold: weightThreshold,
    account_auths: [] as [string, number][],
    key_auths: keyAuths,
  };
}

/** A full SteemAccount row with the authority layout each case needs. */
function makeAccount(name: string, authorities: {
  owner?: ReturnType<typeof authority>;
  active?: ReturnType<typeof authority>;
  posting?: ReturnType<typeof authority>;
}): SteemAccount {
  const owner = authorities.owner ?? authority([[`STMowner-${name}`, 1]]);
  const active = authorities.active ?? authority([[`STMactive-${name}`, 1]]);
  const posting = authorities.posting ?? authority([[`STMposting-${name}`, 1]]);
  return {
    id: 1,
    name,
    owner,
    active,
    posting,
    memo_key: `STMmemo-${name}`,
    json_metadata: '',
    balance: '0.000 STEEM',
    sbd_balance: '0.000 SBD',
    savings_balance: '0.000 STEEM',
    savings_sbd_balance: '0.000 SBD',
    vesting_shares: '0.000000 VESTS',
    delegated_vesting_shares: '0.000000 VESTS',
    received_vesting_shares: '0.000000 VESTS',
    vesting_withdraw_rate: '0.000000 VESTS',
    next_vesting_withdrawal: '1970-01-01T00:00:00',
    withdrawn: 0,
    to_withdraw: 0,
    withdraw_routes: 0,
    created: '1970-01-01T00:00:00',
    last_owner_update: '1970-01-01T00:00:00',
    last_account_update: '1970-01-01T00:00:00',
    last_vote_time: '1970-01-01T00:00:00',
    post_count: 0,
    can_vote: true,
    voting_power: 0,
    last_post: '1970-01-01T00:00:00',
    last_root_post: '1970-01-01T00:00:00',
    vesting_balance: '0.000 STEEM',
    reward_steem_balance: '0.000 STEEM',
    reward_sbd_balance: '0.000 SBD',
    reward_vesting_steem: '0.000 STEEM',
    reward_vesting_balance: '0.000000 VESTS',
    reputation: 0,
    witness_votes: [],
  } as SteemAccount;
}

/** Standard happy-path on-chain view: alice's vault key IS the posting key. */
function accountWithPostingVaultKey(): SteemAccount {
  return makeAccount('alice', { posting: authority([[alicePublicKey, 1]]) });
}

function accountsResponse(accounts: SteemAccount[]) {
  return { success: true, accounts };
}

/** The posting-class and active-class operations used across the cases. */
const postingOp = (account: string): [string, Record<string, unknown>] => [
  'custom_json',
  { required_posting_auths: [account], id: 'community', json: '[]' },
];
const activeOp = (account: string): [string, Record<string, unknown>] => [
  'transfer',
  { from: account, to: 'bob', amount: '1.000 STEEM', memo: 'demo' },
];

/**
 * Fresh signing request per call — the signer SCRUBS `vaultPassword` in its
 * finally block, so a shared frozen request would arrive empty on its second
 * use. Defaults select the demo vault's posting-slot key under the fixture
 * password.
 */
const signRequest = (overrides: Partial<SignOperationsRequest> = {}): SignOperationsRequest => ({
  accountName: 'alice',
  role: 'posting',
  keyIv: posting.iv,
  vaultPassword: v.password,
  operations: [postingOp('alice')],
  ...overrides,
});

describe('vault signer (per-key hierarchy)', () => {
  let fake: FakeIndexedDBHandle;
  let registry: VaultRegistry;
  let manager: VaultManagerExtended;
  // A second vault holding alice's posting AND memo keys — sealed once in
  // beforeAll under the fixture password with fresh per-key IVs.
  let memoVaultAccounts: VaultAccountEntry[];
  let memoVaultPostingIv: string;
  let memoVaultMemoIv: string;
  let signCalls: () => number;

  beforeAll(async () => {
    const kek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    const postingKey = await encryptVaultKeyRecord(kek, aliceWif, 'desktop posting key', []);
    const memoKey = await encryptVaultKeyRecord(kek, ALICE_MEMO_WIF, 'memo never signs', [
      postingKey.iv,
    ]);
    memoVaultPostingIv = postingKey.iv;
    memoVaultMemoIv = memoKey.iv;
    memoVaultAccounts = [
      {
        accountName: 'alice',
        keys: { owner: [], active: [], posting: [postingKey], memo: [memoKey] },
      },
    ];
    kek.fill(0);
  }, 30000);

  beforeEach(async () => {
    fake = installFakeIndexedDB();
    registry = await openVaultRegistry();
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('demo'));
    fake.seed(VAULT_DB_NAME, 'vaults', makeRecord('memo-vault', { accounts: memoVaultAccounts }));
    manager = createVaultManager(registry);
    mockFetchAccounts.mockReset();
    vi.mocked(steem.auth.signTransaction).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        json: async () => TRANSACTION_HEADER,
      })),
    );
    signCalls = () => vi.mocked(steem.auth.signTransaction).mock.calls.length;
  });

  afterEach(() => {
    manager.destroy();
    registry.close();
    vi.unstubAllGlobals();
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

  describe('operation classifier (shared table)', () => {
    it('maps every table entry and resolves the two payload-dependent ops', () => {
      expect(resolveRequiredAuthorityClass([activeOp('alice')])).toBe('active');
      expect(resolveRequiredAuthorityClass([postingOp('alice')])).toBe('posting');
      expect(
        resolveRequiredAuthorityClass([['claim_reward_balance', { account: 'alice' }]]),
      ).toBe('posting');
      expect(
        resolveRequiredAuthorityClass([['change_recovery_account', {}]]),
      ).toBe('owner');
      // account_update: owner only when the payload carries an owner authority.
      expect(
        resolveRequiredAuthorityClass([['account_update', { account: 'alice' }]]),
      ).toBe('active');
      expect(
        resolveRequiredAuthorityClass([
          ['account_update', { account: 'alice', owner: authority([[alicePublicKey, 1]]) }],
        ]),
      ).toBe('owner');
      // custom_json: active when required_auths is non-empty.
      expect(
        resolveRequiredAuthorityClass([
          ['custom_json', { required_auths: ['alice'], id: 'x', json: '{}' }],
        ]),
      ).toBe('active');
    });

    it('mixed operations require the most privileged class; garbage fails closed', () => {
      expect(resolveRequiredAuthorityClass([postingOp('alice'), activeOp('alice')])).toBe('active');
      const expectClassifierRejection = (operations: unknown[]): void => {
        try {
          resolveRequiredAuthorityClass(operations);
          throw new Error('expected the classifier to reject');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as { code?: unknown }).code).toBe('VAULT_OPERATION_UNSUPPORTED');
        }
      };
      expectClassifierRejection([]);
      expectClassifierRejection([['vote', {}]]);
      expectClassifierRejection([['recover_account', {}]]);
      expectClassifierRejection([['transfer', 'not-an-object']]);
      expectClassifierRejection([['custom_json', { id: 'x', json: '{}' }]]);
    });
  });

  describe('authority precheck (traffic contract)', () => {
    it('happy path: one sorted batched fresh query; signs with the selected key only; no leaks', async () => {
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await manager.activateVault('demo');
      const before = await currentRecord('demo');
      const request = signRequest();
      const result = await manager.createSigner().signOperations(request);
      // Exactly ONE batched query, sorted, L1-bypassing (server cache intact).
      expect(mockFetchAccounts).toHaveBeenCalledTimes(1);
      expect(mockFetchAccounts).toHaveBeenCalledWith(['alice'], { fresh: true });
      // The signing call received the header fields and exactly the selected
      // vault WIF.
      expect(signCalls()).toBe(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [tx, keys] = call as [Record<string, unknown>, string[]];
      expect(tx['ref_block_num']).toBe(TRANSACTION_HEADER.ref_block_num);
      expect(tx['ref_block_prefix']).toBe(TRANSACTION_HEADER.ref_block_prefix);
      expect(tx['expiration']).toBe(TRANSACTION_HEADER.expiration);
      expect(tx['operations']).toEqual([postingOp('alice')]);
      expect(keys).toEqual([aliceWif]);
      // Public result shape; the vault STAYS locked (no session is formed).
      expect(result.accountName).toBe('alice');
      expect(result.role).toBe('posting');
      expect(result.publicKey).toBe(alicePublicKey);
      expect(result.locked).toBe(true);
      expect(result.transactionId).toMatch(/^[0-9a-f]{40}$/);
      // Cleanup contract: the request's password was scrubbed after use and
      // the stored record is byte-identical (signing never writes).
      expect(request.vaultPassword).toBe('');
      expect(await currentRecord('demo')).toEqual(before);
      // Hard leak assertions: no WIF, KEK fragment, password or sensitive
      // field names anywhere in the exported result.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(aliceWif);
      expect(serialized).not.toContain(v.kekHex.slice(0, 32));
      expect(serialized).not.toContain(v.password);
      const keyNames: string[] = [];
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value !== null && typeof value === 'object') {
          for (const [k, inner] of Object.entries(value)) {
            keyNames.push(k);
            walk(inner);
          }
        }
      };
      walk(result);
      expect(keyNames).not.toContain('privateKey');
      expect(keyNames).not.toContain('kek');
      expect(keyNames).not.toContain('vaultPassword');
    }, 30000);

    it.each([
      ['body flagged degraded', { success: true, accounts: [], degraded: true }],
      ['success flag missing', { accounts: [] }],
      ['accounts array missing', { success: true }],
      ['involved account missing from the list', accountsResponse([])],
    ])('rejects with VAULT_AUTHORITY_UNAVAILABLE when %s — and never signs', async (_name, response) => {
      mockFetchAccounts.mockResolvedValue(response);
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('rejects when authority data is malformed (missing key_auths / threshold)', async () => {
      const broken = accountWithPostingVaultKey();
      broken.posting = { weight_threshold: 1, account_auths: [] } as unknown as SteemAccount['posting'];
      mockFetchAccounts.mockResolvedValue(accountsResponse([broken]));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('rejects when the accounts fetch itself fails (RPC unavailable)', async () => {
      mockFetchAccounts.mockRejectedValue(new Error('network down'));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('requires a selected vault before anything else (VAULT_EMPTY, no query, no sign)', async () => {
      // Per-key era: signing needs no UNLOCK, but it needs a vault to read —
      // with no session and no active vault there is nothing to select from.
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_EMPTY' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    });
  });

  describe('selected-key pointer and password (per-key contract)', () => {
    it('refuses an unknown key IV before any query or signing (VAULT_KEY_INVALID)', async () => {
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest({ keyIv: 'AAAAAAAAAAAAAAAA' })),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    }, 30000);

    it('a wrong vault password fails authenticated decryption and never signs', async () => {
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest({ vaultPassword: 'wrong-password-123456' })),
      ).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('selects within the requested role only (an active-slot IV is not a posting key)', async () => {
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await manager.activateVault('demo');
      // The active key's IV does not exist under the posting role — the IV is
      // the pointer and the role is its namespace.
      await expect(
        manager.createSigner().signOperations(signRequest({ keyIv: active.iv })),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    }, 30000);
  });

  describe('key selection over the full on-chain authority', () => {
    it('finds the vault key beyond key_auths[0]', async () => {
      const account = makeAccount('alice', {
        posting: authority([[OTHER_POSTING_KEY, 1], [alicePublicKey, 1]]),
      });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('demo');
      const result = await manager.createSigner().signOperations(signRequest());
      expect(result.publicKey).toBe(alicePublicKey);
      expect(result.role).toBe('posting');
      expect(signCalls()).toBe(1);
    }, 30000);

    it('rejects when no single key meets weight_threshold', async () => {
      const account = makeAccount('alice', {
        posting: authority([[alicePublicKey, 1]], 2), // alone: 1 < 2
      });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('posting-class op signs via downward coverage from the ACTIVE authority (role reported truthfully)', async () => {
      // The posting-slot key's public key sits in the account's ACTIVE
      // authority only — Steem's consensus fallback lets an active key sign
      // posting-class operations, and the result reports the level used.
      const account = makeAccount('alice', { active: authority([[alicePublicKey, 1]]) });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('demo');
      const result = await manager.createSigner().signOperations(signRequest());
      expect(result.role).toBe('active');
      expect(result.publicKey).toBe(alicePublicKey);
      expect(signCalls()).toBe(1);
    }, 30000);

    it('keys placed in the owner authority cover both active- and posting-class ops', async () => {
      const account = makeAccount('alice', {
        owner: authority([[alicePublicKey, 1], [activePublicKey, 1]]),
      });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('demo');
      const signer = manager.createSigner();
      const activeResult = await signer.signOperations(
        signRequest({ role: 'active', keyIv: active.iv, operations: [activeOp('alice')] }),
      );
      expect(activeResult.role).toBe('owner');
      const postingResult = await signer.signOperations(signRequest());
      expect(postingResult.role).toBe('owner');
      expect(signCalls()).toBe(2);
    }, 30000);

    it('the requested role is a floor: no downgrade below it even when a lower key exists', async () => {
      // The ACTIVE-slot key sits only in the account's posting authority;
      // the request asks for active on a posting-class op — the walk starts
      // at active and must not fall back down to the posting placement.
      const account = makeAccount('alice', {
        posting: authority([[activePublicKey, 1]]),
      });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(
          signRequest({ role: 'active', keyIv: active.iv }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    }, 30000);

    it('memo keys are stored but can never be selected for signing', async () => {
      // The memo-vault holds alice's posting AND memo keys; the on-chain
      // posting authority contains ONLY the memo key's public key. The memo
      // key is unreachable as a signing candidate twice over: the memo role
      // is refused outright, and the posting-slot key (whose public key is
      // not on-chain here) cannot fall back onto the memo placement.
      const account = makeAccount('alice', {
        posting: authority([[aliceMemoPublicKey, 1]]),
      });
      mockFetchAccounts.mockResolvedValue(accountsResponse([account]));
      await manager.activateVault('memo-vault');
      await expect(
        manager.createSigner().signOperations(
          // Type-level lie on purpose: the runtime value is the memo role the
          // signer must refuse (requireSigningRole rejects it).
          signRequest({ role: 'memo' as 'posting', keyIv: memoVaultMemoIv }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      await expect(
        manager.createSigner().signOperations(
          signRequest({ keyIv: memoVaultPostingIv }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(mockFetchAccounts).toHaveBeenCalledTimes(1); // only the posting attempt queried
      expect(signCalls()).toBe(0);
    }, 30000);
  });

  describe('unsupported operations and garbage input', () => {
    it('unknown operation types fail closed before any query or signing', async () => {
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(
          signRequest({ operations: [['piquant_novel_op', {}]] }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_OPERATION_UNSUPPORTED' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    });

    it('recover_account is deliberately unsupported: VAULT_OPERATION_UNSUPPORTED, zero signing', async () => {
      // Chain semantics: recover_account requires the old (recent) owner AND
      // the new owner to BOTH sign (client.ts signRecoverAccount; the
      // 2026-10-08 production incident — a single owner signature is
      // rejected with tx_missing_other_auth). The vault signer's
      // single-key model cannot express dual-key signing, so the op is
      // deliberately absent from the table and fails closed here; recovery
      // flows keep their dedicated dual-key path.
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(
          signRequest({
            role: 'owner',
            operations: [
              [
                'recover_account',
                {
                  account_to_recover: 'alice',
                  new_owner_authority: { weight_threshold: 1, account_auths: [], key_auths: [] },
                  recent_owner_authority: { weight_threshold: 1, account_auths: [], key_auths: [] },
                },
              ],
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: 'VAULT_OPERATION_UNSUPPORTED' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    });

    it('empty operation lists and malformed account names fail closed', async () => {
      await manager.activateVault('demo');
      await expect(
        manager.createSigner().signOperations(signRequest({ operations: [] })),
      ).rejects.toMatchObject({ code: 'VAULT_OPERATION_UNSUPPORTED' });
      await expect(
        manager.createSigner().signOperations(signRequest({ accountName: 'not a valid name!' })),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    });
  });

  describe('frozen transactions (signResolvedTransaction)', () => {
    const frozenTx = {
      ref_block_num: 12345,
      ref_block_prefix: 1234567890,
      expiration: '2026-10-31T00:00:00',
      operations: [activeOp('alice')] as [string, Record<string, unknown>][],
      extensions: [],
    };

    beforeEach(async () => {
      mockFetchAccounts.mockResolvedValue(
        accountsResponse([makeAccount('alice', { active: authority([[activePublicKey, 1]]) })]),
      );
      await manager.activateVault('demo');
    });

    it('passes the frozen fields verbatim into the signing call and never fetches a header', async () => {
      const fetchSpy = vi.mocked(fetch);
      const result = await manager.createSigner().signResolvedTransaction({
        accountName: 'alice',
        role: 'active',
        keyIv: active.iv,
        vaultPassword: v.password,
        transaction: frozenTx,
      });
      // No header refresh: the global fetch was never touched.
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(signCalls()).toBe(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [tx, keys] = call as [Record<string, unknown>, string[]];
      expect(tx['ref_block_num']).toBe(12345);
      expect(tx['ref_block_prefix']).toBe(1234567890);
      expect(tx['expiration']).toBe('2026-10-31T00:00:00');
      expect(tx['operations']).toEqual(frozenTx.operations);
      expect(keys).toEqual([active.privateKey]);
      expect(result.role).toBe('active');
    });

    it('pins the exact fixture transaction id (real serializer + real SHA-256)', async () => {
      // vectors.exactTransaction: the fixed transfer with these frozen fields
      // hashes (SHA-256 of the unsigned serialization, first 20 bytes) to
      // 07c1af89bc7bfbbe2b9261e0b6cb3bf231b98c4d. The mock signTransaction
      // proves the call; THIS asserts the id computation is byte-real.
      const exact = {
        ...frozenTx,
        operations: vectors.exactTransaction.unsignedTx.operations as [string, Record<string, unknown>][],
      };
      const result = await manager.createSigner().signResolvedTransaction({
        accountName: 'alice',
        role: 'active',
        keyIv: active.iv,
        vaultPassword: v.password,
        transaction: exact,
      });
      expect(result.transactionId).toBe(vectors.exactTransaction.transactionId);
    });

    it('still runs the authority precheck and rejects on degraded data', async () => {
      mockFetchAccounts.mockResolvedValue({ success: true, accounts: [], degraded: true });
      await expect(
        manager.createSigner().signResolvedTransaction({
          accountName: 'alice',
          role: 'active',
          keyIv: active.iv,
          vaultPassword: v.password,
          transaction: frozenTx,
        }),
      ).rejects.toMatchObject({ code: 'VAULT_AUTHORITY_UNAVAILABLE' });
      expect(signCalls()).toBe(0);
    });

    it('rejects malformed frozen transactions (VAULT_OPERATION_UNSUPPORTED)', async () => {
      await expect(
        manager.createSigner().signResolvedTransaction({
          accountName: 'alice',
          role: 'active',
          keyIv: active.iv,
          vaultPassword: v.password,
          transaction: { ref_block_num: 1 } as unknown as typeof frozenTx,
        }),
      ).rejects.toMatchObject({ code: 'VAULT_OPERATION_UNSUPPORTED' });
      expect(signCalls()).toBe(0);
    });
  });

  describe('mid-flight record drift', () => {
    it('refuses to sign when the vault record moves while the header fetch is in flight', async () => {
      mockFetchAccounts.mockResolvedValue(accountsResponse([accountWithPostingVaultKey()]));
      await manager.activateVault('demo');
      // The header fetch doubles as the drift injection point: another actor
      // locks the vault (epoch bump) after the record was captured but
      // before the selected key is decrypted and used.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          await registry.bumpLockEpoch('demo');
          return { ok: true, headers: new Headers(), json: async () => TRANSACTION_HEADER };
        }),
      );
      await expect(
        manager.createSigner().signOperations(signRequest()),
      ).rejects.toMatchObject({ code: 'VAULT_SESSION_STALE' });
      expect(signCalls()).toBe(0);
    }, 30000);
  });

  describe('legacy privateKey signer (no vault, no authority precheck)', () => {
    // The legacy signer sources its WIF from an injected getter (the A6
    // login-state wiring point). DELIBERATE DIFFERENCE under test: it never
    // queries /api/query/accounts — privateKey mode must keep behaving like
    // today's src/lib/steem/client.ts signing path. The shared request type
    // now carries keyIv/vaultPassword; the legacy backend ignores both
    // (there is no vault behind it) — the values below are inert labels.
    const legacyRequest = (overrides: Partial<SignOperationsRequest> = {}): SignOperationsRequest => ({
      accountName: 'alice',
      role: 'posting',
      keyIv: 'private-key-mode',
      vaultPassword: 'private-key-mode',
      operations: [postingOp('alice')],
      ...overrides,
    });

    it('signs with the injected key and the fetched header; result stays key-free', async () => {
      const getPrivateKey = vi.fn(() => aliceWif);
      const signer = createLegacyPrivateKeySigner(getPrivateKey);
      const result = await signer.signOperations(legacyRequest());
      // No authority precheck: the accounts client is never touched.
      expect(mockFetchAccounts).not.toHaveBeenCalled();
      expect(getPrivateKey).toHaveBeenCalledWith('alice', 'posting');
      expect(signCalls()).toBe(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [tx, keys] = call as [Record<string, unknown>, string[]];
      expect(tx['ref_block_num']).toBe(TRANSACTION_HEADER.ref_block_num);
      expect(tx['expiration']).toBe(TRANSACTION_HEADER.expiration);
      expect(keys).toEqual([aliceWif]);
      // The requested role is the role used; no vault session exists.
      expect(result.role).toBe('posting');
      expect(result.publicKey).toBe(alicePublicKey);
      expect(result.locked).toBe(false);
      expect(result.transactionId).toMatch(/^[0-9a-f]{40}$/);
      expect(JSON.stringify(result)).not.toContain(aliceWif);
    });

    it('maps a missing key to VAULT_KEY_INVALID (re-auth territory for A6)', async () => {
      const signer = createLegacyPrivateKeySigner(() => undefined);
      await expect(
        signer.signOperations(legacyRequest({ role: 'active', operations: [activeOp('alice')] })),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(signCalls()).toBe(0);
    });

    it('fails closed on unsupported operations and memo roles before resolving any key', async () => {
      const getPrivateKey = vi.fn(() => aliceWif);
      const signer = createLegacyPrivateKeySigner(getPrivateKey);
      await expect(
        signer.signOperations(legacyRequest({ operations: [['brand_new_op', {}]] })),
      ).rejects.toMatchObject({ code: 'VAULT_OPERATION_UNSUPPORTED' });
      await expect(
        signer.signOperations(legacyRequest({ role: 'memo' as 'posting' })),
      ).rejects.toMatchObject({ code: 'VAULT_KEY_INVALID' });
      expect(getPrivateKey).not.toHaveBeenCalled();
      expect(signCalls()).toBe(0);
    });

    it('signs frozen transactions verbatim (no header fetch) and pins the fixture txid', async () => {
      const signer = createLegacyPrivateKeySigner(() => aliceWif);
      const exact = {
        ref_block_num: 12345,
        ref_block_prefix: 1234567890,
        expiration: '2026-10-31T00:00:00',
        operations: vectors.exactTransaction.unsignedTx.operations as [string, Record<string, unknown>][],
        extensions: [],
      };
      const fetchSpy = vi.mocked(fetch);
      const result = await signer.signResolvedTransaction({
        accountName: 'alice',
        role: 'active',
        keyIv: 'private-key-mode',
        vaultPassword: 'private-key-mode',
        transaction: exact,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(signCalls()).toBe(1);
      const call = vi.mocked(steem.auth.signTransaction).mock.calls[0];
      expect(call).toBeDefined();
      const [tx, keys] = call as [Record<string, unknown>, string[]];
      expect(tx).toMatchObject({
        ref_block_num: 12345,
        ref_block_prefix: 1234567890,
        expiration: '2026-10-31T00:00:00',
      });
      expect(keys).toEqual([aliceWif]);
      expect(result.transactionId).toBe(vectors.exactTransaction.transactionId);
      expect(result.role).toBe('active');
    });
  });
});
