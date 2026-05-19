import { describe, expect, it } from 'vitest';
import {
  computeEstimatedAccountValueUsd,
  formatEstimatedAccountValueUsd,
} from '@/lib/wallet/estimated-account-value';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

const globalProps: GlobalPropsData = {
  total_vesting_shares: '100000000.000000 VESTS',
  total_vesting_fund_steem: '50000000.000 STEEM',
};

const balance: WalletBalanceData = {
  balance: '10.000 STEEM',
  sbd_balance: '5.000 SBD',
  vesting_shares: '20000000.000000 VESTS',
  delegated_vesting_shares: '0.000000 VESTS',
  received_vesting_shares: '0.000000 VESTS',
  vesting_withdraw_rate: '0.000000 VESTS',
  savings_balance: '1.000 STEEM',
  savings_sbd_balance: '2.000 SBD',
  next_vesting_withdrawal: '',
  to_withdraw: '0.000000 VESTS',
  withdrawn: '0.000000 VESTS',
  reward_steem_balance: '0.000 STEEM',
  reward_sbd_balance: '0.000 SBD',
  reward_vesting_steem: '0.000000 VESTS',
};

describe('computeEstimatedAccountValueUsd', () => {
  it('sums STEEM and SBD holdings with market prices', () => {
    const smallBalance: WalletBalanceData = {
      ...balance,
      vesting_shares: '1000.000000 VESTS',
      balance: '10.000 STEEM',
      savings_balance: '0.000 STEEM',
      sbd_balance: '5.000 SBD',
      savings_sbd_balance: '0.000 SBD',
    };
    const value = computeEstimatedAccountValueUsd(
      smallBalance,
      globalProps,
      { steemPrice: 0.5, sbdPrice: 1 }
    );
    // SP: 1000/100M * 50M = 500 STEEM; liquid 10 STEEM; SBD 5
    expect(value).toBe(510 * 0.5 + 5 * 1);
  });

  it('falls back to SBD face value when sbd price is zero', () => {
    const value = computeEstimatedAccountValueUsd(
      {
        ...balance,
        vesting_shares: '0.000000 VESTS',
        balance: '0.000 STEEM',
        savings_balance: '0.000 STEEM',
        sbd_balance: '10.000 SBD',
        savings_sbd_balance: '0.000 SBD',
      },
      globalProps,
      { steemPrice: 0.5, sbdPrice: 0 }
    );
    expect(value).toBe(10);
  });

  it('returns null when steem price is zero', () => {
    const value = computeEstimatedAccountValueUsd(balance, globalProps, {
      steemPrice: 0,
      sbdPrice: 1,
    });
    expect(value).toBeNull();
  });
});

describe('formatEstimatedAccountValueUsd', () => {
  it('formats USD with commas', () => {
    expect(formatEstimatedAccountValueUsd(1234.5)).toBe('$1,234.50');
  });

  it('returns placeholder when value is null', () => {
    expect(formatEstimatedAccountValueUsd(null)).toBe('---');
  });
});
