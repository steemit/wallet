import { describe, expect, it } from 'vitest';
import {
  formatSteemPowerDisplay,
  steemPowerFromVests,
  steemPowerFromVestsString,
} from '@/lib/wallet/vest-steem';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';

const globalProps: GlobalPropsData = {
  total_vesting_shares: '100.000000 VESTS',
  total_vesting_fund_steem: '50.000 STEEM',
};

describe('vest-steem', () => {
  it('converts vests to steem power using chain ratio', () => {
    expect(steemPowerFromVests(10, globalProps)).toBe(5);
  });

  it('parses vest asset strings', () => {
    expect(steemPowerFromVestsString('10.000000 VESTS', globalProps)).toBe(5);
  });

  it('formats steem power with thousands separators', () => {
    expect(formatSteemPowerDisplay(1234.5)).toBe('1,234.500');
  });
});
