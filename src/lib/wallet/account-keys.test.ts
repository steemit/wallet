import { describe, expect, it } from 'vitest';
import {
  getPublicKeysForAuth,
  wifForPublicKey,
  type AuthRoleKeys,
} from '@/lib/wallet/account-keys';
import type { SteemAccount } from '@/lib/steem/types';

const sampleAccount = {
  name: 'alice',
  memo_key: 'STMmemoPub',
  posting: { key_auths: [['STMpostPub', 1]], account_auths: [], weight_threshold: 1 },
  active: { key_auths: [['STMacPub', 1]], account_auths: [], weight_threshold: 1 },
  owner: { key_auths: [['STMownPub', 1]], account_auths: [], weight_threshold: 1 },
} as unknown as SteemAccount;

describe('getPublicKeysForAuth', () => {
  it('returns memo_key for memo', () => {
    expect(getPublicKeysForAuth(sampleAccount, 'memo')).toEqual(['STMmemoPub']);
  });

  it('returns key_auths public keys for posting', () => {
    expect(getPublicKeysForAuth(sampleAccount, 'posting')).toEqual(['STMpostPub']);
  });
});

describe('wifForPublicKey', () => {
  it('returns undefined when no keys match', () => {
    const keys: AuthRoleKeys = {
      ownerKey: null,
      activeKey: null,
      postingKey: null,
      memoKey: null,
    };
    expect(wifForPublicKey('STMunknown', keys)).toBeUndefined();
  });
});
