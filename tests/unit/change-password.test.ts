import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SteemAccount } from '@/lib/steem/types';
import {
  buildAccountUpdateForPasswordChange,
  generateNewMasterPassword,
  looksLikePublicKey,
  resolveOwnerSigningKey,
  verifyCurrentPasswordMatchesAccount,
} from '@/lib/wallet/change-password';
import { steem } from '@steemit/steem-js';

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    isValidPrivateKey: vi.fn((value: string) => /^5J/.test(value)),
    privateKeyToPublicKey: vi.fn((wif: string) => `STM${wif.slice(-8)}`),
  },
}));

const baseAccount = {
  id: 1,
  name: 'alice',
  owner: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STMownerPub', 1]],
  },
  active: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STMactivePub', 1]],
  },
  posting: {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [['STMpostPub', 1]],
  },
  memo_key: 'STMmemoPub',
  json_metadata: '{}',
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
  created: '2016-01-01T00:00:00',
  last_owner_update: '2016-01-01T00:00:00',
  last_account_update: '2016-01-01T00:00:00',
  last_vote_time: '1970-01-01T00:00:00',
  post_count: 0,
  can_vote: true,
  voting_power: 10000,
  last_post: '1970-01-01T00:00:00',
  last_root_post: '1970-01-01T00:00:00',
  last_bandwidth_update: '1970-01-01T00:00:00',
  average_bandwidth: 0,
  lifetime_bandwidth: 0,
  vesting_balance: '0.000000 VESTS',
  reputation: 0,
  witness_votes: [],
} as SteemAccount;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(steem.auth.toWif).mockImplementation(
    (name: string, password: string, role: string) => `5J${name}-${role}-${password}`
  );
  vi.mocked(steem.auth.wifToPublic).mockImplementation((wif: string) => {
    if (wif === '5Jalice-owner-oldpass') return 'STMownerPub';
    if (wif === '5Jalice-active-oldpass') return 'STMactivePub';
    if (wif === '5Jalice-posting-oldpass') return 'STMpostPub';
    if (wif === '5Jalice-memo-oldpass') return 'STMmemoPub';
    if (wif.startsWith('5Jalice-owner-')) return 'STMnewOwnerPub';
    if (wif.startsWith('5Jalice-active-')) return 'STMnewActivePub';
    if (wif.startsWith('5Jalice-posting-')) return 'STMnewPostPub';
    if (wif.startsWith('5Jalice-memo-')) return 'STMnewMemoPub';
    return `STM${wif.slice(-8)}`;
  });
  vi.mocked(steem.auth.getPrivateKey).mockReturnValue('randomWifSuffix');
});

describe('change-password helpers', () => {
  it('generateNewMasterPassword prefixes P', () => {
    expect(generateNewMasterPassword()).toBe('PrandomWifSuffix');
  });

  it('looksLikePublicKey rejects STM public keys but accepts WIF/password', () => {
    expect(looksLikePublicKey('STMownerPub')).toBe(true);
    expect(looksLikePublicKey('5Jprivate')).toBe(false);
    expect(looksLikePublicKey('my-master-password')).toBe(false);
  });

  it('resolveOwnerSigningKey returns owner WIF when password matches', () => {
    expect(resolveOwnerSigningKey(baseAccount, 'oldpass')).toBe('5Jalice-owner-oldpass');
  });

  it('resolveOwnerSigningKey throws for wrong password', () => {
    expect(() => resolveOwnerSigningKey(baseAccount, 'wrong')).toThrow('Incorrect Password');
  });

  it('verifyCurrentPasswordMatchesAccount validates all roles', () => {
    expect(verifyCurrentPasswordMatchesAccount(baseAccount, 'oldpass')).toBe(true);
    expect(verifyCurrentPasswordMatchesAccount(baseAccount, 'wrong')).toBe(false);
  });

  it('buildAccountUpdateForPasswordChange builds account_update with new authorities', () => {
    const accountWithObjectMeta = {
      ...baseAccount,
      json_metadata: { profile: { name: 'alice' } } as unknown as string,
    };
    const { operation, signingKey } = buildAccountUpdateForPasswordChange(
      accountWithObjectMeta,
      'oldpass',
      'PnewGenerated'
    );

    expect(signingKey).toBe('5Jalice-owner-oldpass');
    expect(operation[0]).toBe('account_update');
    const payload = operation[1];
    expect(payload.account).toBe('alice');
    expect(payload.owner).toEqual({
      weight_threshold: 1,
      account_auths: [],
      key_auths: [['STMnewOwnerPub', 1]],
    });
    expect(payload.memo_key).toBe('STMnewMemoPub');
    expect(payload.json_metadata).toBe('{"profile":{"name":"alice"}}');
  });

  it('normalizeOperationForBroadcast rejects array-shaped owner authority', () => {
    expect(() =>
      steem.auth.normalizeOperationForBroadcast([
        'account_update',
        {
          account: 'alice',
          owner: [['STMbad', 1]],
          active: { weight_threshold: 1, account_auths: [], key_auths: [['STMa', 1]] },
          posting: { weight_threshold: 1, account_auths: [], key_auths: [['STMp', 1]] },
          memo_key: 'STMm',
          json_metadata: '{}',
        },
      ])
    ).toThrow(/Invalid owner authority/);
  });
});
