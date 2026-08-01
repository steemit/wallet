import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @steemit/steem-js — verifyTransaction is the v1.0.20 crypto verifier.
const mockVerifyTransaction = vi.fn();
vi.mock('@steemit/steem-js', () => ({
  steem: {
    auth: {
      verifyTransaction: (...args: unknown[]) => mockVerifyTransaction(...args),
      normalizeTransactionForBroadcast: vi.fn((tx: unknown) => tx),
    },
    api: { setOptions: vi.fn() },
  },
}));

import { SteemService } from '@/lib/steem/server';
import { validateRelayTransaction } from '@/lib/steem/validate-signed-tx-op';
import type { SignedTransaction, SteemAccount } from '@/lib/steem/types';

function makeSignedTx(op: [string, unknown] = ['transfer', { from: 'a', to: 'b' }]): SignedTransaction {
  return {
    ref_block_num: 1,
    ref_block_prefix: 2,
    expiration: '2026-07-10T00:00:00',
    operations: [op],
    extensions: [],
    signatures: ['sig123'],
  } as unknown as SignedTransaction;
}

function makeAccount(overrides?: Partial<SteemAccount>): SteemAccount {
  return {
    id: 1,
    name: 'alice',
    owner: { key_auths: [['STM5Owner', 1]], account_auths: [], weight_threshold: 1 },
    active: { key_auths: [['STM5Active', 1]], account_auths: [], weight_threshold: 1 },
    posting: { key_auths: [['STM5Posting', 1]], account_auths: [], weight_threshold: 1 },
    memo_key: 'STM5Memo',
    json_metadata: '',
    balance: '0.000 STEEM',
    sbd_balance: '0.000 SBD',
    savings_balance: '0.000 STEEM',
    savings_sbd_balance: '0.000 SBD',
    vesting_shares: '0.000000 VESTS',
    delegated_vesting_shares: '0.000000 VESTS',
    received_vesting_shares: '0.000000 VESTS',
    vesting_withdraw_rate: '0.000000 VESTS',
    next_vesting_withdrawal: '1969-12-31T23:59:59',
    withdrawn: 0,
    to_withdraw: 0,
    withdraw_routes: 0,
    created: '2020-01-01T00:00:00',
    last_owner_update: '2020-01-01T00:00:00',
    last_account_update: '2020-01-01T00:00:00',
    last_vote_time: '2020-01-01T00:00:00',
    post_count: 0,
    can_vote: true,
    voting_power: 100,
    last_post: '2020-01-01T00:00:00',
    last_root_post: '2020-01-01T00:00:00',
    last_bandwidth_update: '2020-01-01T00:00:00',
    average_bandwidth: 0,
    lifetime_bandwidth: 0,
    vesting_balance: '0.000 STEEM',
    reputation: 0,
    witness_votes: [],
    ...overrides,
  } as unknown as SteemAccount;
}

describe('SteemService.verifyTransactionForAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when the shape is invalid', () => {
    const badTx = { signatures: [] } as unknown as SignedTransaction;
    expect(SteemService.verifyTransactionForAccount(badTx, makeAccount())).toBe(false);
    expect(mockVerifyTransaction).not.toHaveBeenCalled();
  });

  it('returns true when verifyTransaction matches any account key', () => {
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Active');
    expect(SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount())).toBe(true);
  });

  it('returns false when no account key verifies the signature', () => {
    mockVerifyTransaction.mockReturnValue(false);
    expect(SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount())).toBe(false);
  });

  it('returns false (not throw) when verifyTransaction throws', () => {
    mockVerifyTransaction.mockImplementation(() => {
      throw new Error('crypto error');
    });
    expect(SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount())).toBe(false);
  });

  it('with requiredAuthority=active: accepts active key, rejects memo/posting key', () => {
    // Only the active key verifies; posting/memo keys return false.
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Active');
    expect(
      SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount(), 'active')
    ).toBe(true);
  });

  it('with requiredAuthority=active: rejects when only memo key verifies', () => {
    // Simulate: the signature matches the memo key, but NOT the active key.
    // With authority filtering, memo is excluded → must return false.
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Memo');
    expect(
      SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount(), 'active')
    ).toBe(false);
  });

  it('with requiredAuthority=posting: accepts posting key only', () => {
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Posting');
    expect(
      SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount(), 'posting')
    ).toBe(true);
  });

  it('with requiredAuthority=owner: accepts owner key only', () => {
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Owner');
    expect(
      SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount(), 'owner')
    ).toBe(true);
  });

  it('without requiredAuthority: checks all keys including memo (backwards compat)', () => {
    mockVerifyTransaction.mockImplementation((_tx, pubKey) => pubKey === 'STM5Memo');
    expect(SteemService.verifyTransactionForAccount(makeSignedTx(), makeAccount())).toBe(true);
  });
});

describe('SteemService.verifyTransactionForUsername', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTransaction.mockReturnValue(true);
  });

  it('returns ok:false when shape is invalid', async () => {
    const badTx = { signatures: [] } as unknown as SignedTransaction;
    const res = await SteemService.verifyTransactionForUsername(badTx, 'alice');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid transaction format');
  });

  it('returns ok:false when account lookup fails', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockRejectedValue(new Error('rpc down'));
    const res = await SteemService.verifyTransactionForUsername(makeSignedTx(), 'alice');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('account lookup failed');
    spy.mockRestore();
  });

  it('returns ok:false when account not found', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([]);
    const res = await SteemService.verifyTransactionForUsername(makeSignedTx(), 'alice');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('account not found');
    spy.mockRestore();
  });

  it('returns ok:false when signature does not match', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([makeAccount()]);
    mockVerifyTransaction.mockReturnValue(false);
    const res = await SteemService.verifyTransactionForUsername(makeSignedTx(), 'alice');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('does not match account');
    spy.mockRestore();
  });

  it('returns ok:true when signature matches', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([makeAccount()]);
    mockVerifyTransaction.mockReturnValue(true);
    const res = await SteemService.verifyTransactionForUsername(makeSignedTx(), 'alice');
    expect(res.ok).toBe(true);
    spy.mockRestore();
  });
});

describe('validateRelayTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTransaction.mockReturnValue(true);
  });

  it('returns 400 response when op type does not match', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([makeAccount()]);
    const res = await validateRelayTransaction(
      makeSignedTx(['vote', {}]),
      'transfer',
      'alice'
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const data = await res!.json();
    expect(data.error).toContain('expected transfer');
    spy.mockRestore();
  });

  it('returns 400 when signature verification fails', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([makeAccount()]);
    mockVerifyTransaction.mockReturnValue(false);
    const res = await validateRelayTransaction(makeSignedTx(), 'transfer', 'alice');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    spy.mockRestore();
  });

  it('returns null (valid) when op type and signature are ok', async () => {
    const spy = vi.spyOn(SteemService, 'getAccounts').mockResolvedValue([makeAccount()]);
    mockVerifyTransaction.mockReturnValue(true);
    const res = await validateRelayTransaction(makeSignedTx(), 'transfer', 'alice');
    expect(res).toBeNull();
    spy.mockRestore();
  });
});
