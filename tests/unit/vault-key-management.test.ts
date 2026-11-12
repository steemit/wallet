// On-chain key association checks (R2 key-management). Pure read-only
// orchestration — no PBKDF2, no IndexedDB, no crypto: fast logic tests.
//
// MOCK DISCIPLINE (same as vault-signer.test.ts): '@/lib/steem/accounts-
// client' is vi.mock'ed; the branch cases (degraded / missing / malformed /
// fetch rejection) are contract tests against the response shape the real
// route produces (`{ success, accounts, degraded? }`). The WIF layer is not
// involved at all — this module receives only public keys.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyKeysOnChain, type VaultKeyCandidate } from '@/lib/vault/key-management';
import type { SteemAccount } from '@/lib/steem/types';

// Established accounts-client mock pattern: the factory only closes over the
// fn — the reference resolves at call time.
const mockFetchAccounts = vi.fn();
vi.mock('@/lib/steem/accounts-client', () => ({
  fetchAccounts: (...args: unknown[]) =>
    mockFetchAccounts(...(args as [string[], { fresh?: boolean }])),
}));

/** Authority block as condenser_api returns it (fc::flat_map tuple JSON). */
function authority(keyAuths: Array<[string, number]>, weightThreshold = 1) {
  return {
    weight_threshold: weightThreshold,
    account_auths: [] as [string, number][],
    key_auths: keyAuths,
  };
}

/** A full SteemAccount row with the authority layout each case needs. */
function makeAccount(
  name: string,
  options: {
    owner?: ReturnType<typeof authority>;
    active?: ReturnType<typeof authority>;
    posting?: ReturnType<typeof authority>;
    memoKey?: string;
  } = {},
): SteemAccount {
  return {
    id: 1,
    name,
    owner: options.owner ?? authority([[`STMowner-${name}`, 1]]),
    active: options.active ?? authority([[`STMactive-${name}`, 1]]),
    posting: options.posting ?? authority([[`STMposting-${name}`, 1]]),
    memo_key: options.memoKey ?? `STMmemo-${name}`,
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
    vesting_balance: '0.000000 VESTS',
    reward_steem_balance: '0.000 STEEM',
    reward_sbd_balance: '0.000 SBD',
    reward_vesting_steem: '0.000 STEEM',
    reward_vesting_balance: '0.000000 VESTS',
    reputation: 0,
    witness_votes: [],
  } as SteemAccount;
}

function accountsResponse(accounts: SteemAccount[]) {
  return { success: true, accounts };
}

async function expectUnavailable(candidates: Parameters<typeof verifyKeysOnChain>[0]) {
  let caught: unknown;
  try {
    await verifyKeysOnChain(candidates);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe('VAULT_AUTHORITY_UNAVAILABLE');
}

describe('verifyKeysOnChain (R2 key management)', () => {
  beforeEach(() => {
    mockFetchAccounts.mockReset();
  });

  it('one sorted, deduplicated, fresh batched query; results follow input order', async () => {
    const alice = makeAccount('alice', { posting: authority([['STMposting-alice', 1]]) });
    const bob = makeAccount('bob');
    mockFetchAccounts.mockResolvedValue(accountsResponse([bob, alice]));

    const results = await verifyKeysOnChain([
      { accountName: 'Bob', role: 'posting', publicKey: 'STMposting-bob' },
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
      { accountName: 'ALICE', role: 'owner', publicKey: 'STMowner-alice' },
    ]);

    expect(mockFetchAccounts).toHaveBeenCalledTimes(1);
    expect(mockFetchAccounts).toHaveBeenCalledWith(['alice', 'bob'], { fresh: true });
    // Unmatched echoes the requested role; matched keeps input order.
    expect(results).toHaveLength(3);
    expect(results[1]).toEqual({
      matched: true,
      authority: 'posting',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
    expect(results[2]).toEqual({
      matched: true,
      authority: 'owner',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
  });

  it('scans the FULL key_auths list — a second-entry match is found', async () => {
    const alice = makeAccount('alice', {
      posting: authority([
        ['STMfirst-key', 1],
        ['STMsecond-key', 1],
      ]),
    });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'posting', publicKey: 'STMsecond-key' },
    ]);
    expect(result).toEqual({
      matched: true,
      authority: 'posting',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
  });

  it('reports sub-threshold keys: matched with suffices false (stored, warned)', async () => {
    const alice = makeAccount('alice', {
      active: authority([['STMheavy-key', 2]], 3),
    });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'active', publicKey: 'STMheavy-key' },
    ]);
    expect(result).toEqual({
      matched: true,
      authority: 'active',
      weight: 2,
      threshold: 3,
      suffices: false,
    });
  });

  it('compares memo candidates against the account memo_key', async () => {
    const alice = makeAccount('alice', { memoKey: 'STMthe-memo-key' });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'memo', publicKey: 'STMthe-memo-key' },
    ]);
    expect(result).toEqual({
      matched: true,
      authority: 'memo',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
  });

  it('a memo-role candidate found in a signing authority is reported there', async () => {
    const alice = makeAccount('alice', { posting: authority([['STMactually-posting', 1]]) });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'memo', publicKey: 'STMactually-posting' },
    ]);
    expect(result?.authority).toBe('posting');
    expect(result?.matched).toBe(true);
  });

  it('prefers the most privileged level when a key sits in several authorities', async () => {
    const alice = makeAccount('alice', {
      owner: authority([['STMshared-key', 1]]),
      posting: authority([['STMshared-key', 1]]),
    });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'posting', publicKey: 'STMshared-key' },
    ]);
    expect(result?.authority).toBe('owner');
  });

  it('an unknown public key is unmatched with the requested role echoed', async () => {
    const alice = makeAccount('alice');
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [result] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'active', publicKey: 'STMnot-on-chain' },
    ]);
    expect(result).toEqual({
      matched: false,
      authority: 'active',
      weight: 0,
      threshold: 0,
      suffices: false,
    });
  });

  it('skips malformed key_auths entries instead of trusting them', async () => {
    const alice = makeAccount('alice', {
      posting: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [
          ['STMbroken-weight', Number.NaN],
          'not-a-pair',
          ['STMfine-key', 1],
        ] as unknown as Array<[string, number]>,
      },
    });
    mockFetchAccounts.mockResolvedValue(accountsResponse([alice]));
    const [broken, fine] = await verifyKeysOnChain([
      { accountName: 'alice', role: 'posting', publicKey: 'STMbroken-weight' },
      { accountName: 'alice', role: 'posting', publicKey: 'STMfine-key' },
    ]);
    expect(broken?.matched).toBe(false);
    expect(fine?.matched).toBe(true);
  });

  it.each([
    ['body flagged degraded', { success: true, accounts: [], degraded: true }],
    ['success flag missing', { accounts: [] }],
    ['accounts array missing', { success: true }],
    ['involved account missing from the list', accountsResponse([])],
  ])('fails closed with VAULT_AUTHORITY_UNAVAILABLE when %s', async (_name, response) => {
    mockFetchAccounts.mockResolvedValue(response);
    await expectUnavailable([
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
    ]);
    expect(mockFetchAccounts).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the accounts fetch itself fails (RPC unavailable)', async () => {
    mockFetchAccounts.mockRejectedValue(new Error('network down'));
    await expectUnavailable([
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
    ]);
  });

  it('fails closed on malformed authority data or a malformed memo_key', async () => {
    const brokenAuthority = makeAccount('alice');
    brokenAuthority.active = {
      weight_threshold: 1,
      account_auths: [],
    } as unknown as SteemAccount['active'];
    mockFetchAccounts.mockResolvedValue(accountsResponse([brokenAuthority]));
    await expectUnavailable([
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
    ]);

    const brokenMemo = makeAccount('alice', { memoKey: '' });
    mockFetchAccounts.mockResolvedValue(accountsResponse([brokenMemo]));
    await expectUnavailable([
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
    ]);
  });

  it('fails closed when memo_key is missing or not a string (typeof branch), even for non-memo candidates', async () => {
    // Field absent entirely — condenser_api always returns it, so its absence
    // means the whole row is unreliable.
    const missingMemo = makeAccount('alice');
    delete (missingMemo as unknown as Record<string, unknown>)['memo_key'];
    mockFetchAccounts.mockResolvedValue(accountsResponse([missingMemo]));
    await expectUnavailable([
      { accountName: 'alice', role: 'posting', publicKey: 'STMposting-alice' },
    ]);

    // Present but the wrong type.
    for (const bogus of [null, 42, { key: 'STMmemo-alice' }, ['STMmemo-alice']]) {
      const wrongType = makeAccount('alice');
      (wrongType as unknown as Record<string, unknown>)['memo_key'] = bogus;
      mockFetchAccounts.mockResolvedValue(accountsResponse([wrongType]));
      await expectUnavailable([
        { accountName: 'alice', role: 'memo', publicKey: 'STMmemo-alice' },
      ]);
    }
  });

  it('an empty candidate list returns [] without touching the network', async () => {
    await expect(verifyKeysOnChain([])).resolves.toEqual([]);
    expect(mockFetchAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid account name', { accountName: 'not a steem name!', role: 'posting', publicKey: 'STMx' }],
    ['unsupported role', { accountName: 'alice', role: 'other', publicKey: 'STMx' }],
    ['non-STM public key', { accountName: 'alice', role: 'posting', publicKey: 'BTCx' }],
    ['empty public key', { accountName: 'alice', role: 'posting', publicKey: '' }],
  ])('rejects malformed candidates with VAULT_KEY_INVALID: %s', async (_name, raw) => {
    const candidate = raw as VaultKeyCandidate;
    let caught: unknown;
    try {
      await verifyKeysOnChain([candidate]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: unknown }).code).toBe('VAULT_KEY_INVALID');
    expect(mockFetchAccounts).not.toHaveBeenCalled();
  });
});
