import { describe, expect, it } from 'vitest';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import {
  clampPowerDownVests,
  formatPowerDownWeeklySteem,
  getDefaultPowerDownVests,
  getPowerDownMaxVests,
  getPowerDownToWithdrawVests,
  getPowerDownWithdrawnVests,
  isPowerDownReserveWarning,
  microVestsToVests,
} from '@/lib/wallet/power-down';

const globalProps: GlobalPropsData = {
  total_vesting_shares: '100.000000 VESTS',
  total_vesting_fund_steem: '50.000 STEEM',
};

const baseAccount = {
  vesting_shares: '100.000000 VESTS',
  delegated_vesting_shares: '10.000000 VESTS',
  to_withdraw: 0,
  withdrawn: 0,
};

describe('power-down', () => {
  it('converts micro-vests to vests', () => {
    expect(microVestsToVests(5_000_000)).toBe(5);
  });

  it('computes max vests as vesting minus delegated', () => {
    expect(getPowerDownMaxVests(baseAccount)).toBe(90);
  });

  it('reads to_withdraw and withdrawn from micro-vest fields', () => {
    expect(
      getPowerDownToWithdrawVests({ ...baseAccount, to_withdraw: 20_000_000 })
    ).toBe(20);
    expect(
      getPowerDownWithdrawnVests({ ...baseAccount, withdrawn: 5_000_000 })
    ).toBe(5);
  });

  it('defaults to remaining power down when already active', () => {
    const account = {
      ...baseAccount,
      to_withdraw: 40_000_000,
      withdrawn: 10_000_000,
    };
    expect(getDefaultPowerDownVests(account, globalProps)).toBe(30);
  });

  it('defaults to available minus 5.001 STEEM reserve when not active', () => {
    // max = 90 vests; 5.001 STEEM = 10.002 vests at 2:1 ratio
    expect(getDefaultPowerDownVests(baseAccount, globalProps)).toBeCloseTo(79.998, 3);
  });

  it('clamps withdraw amount to max', () => {
    expect(clampPowerDownVests(120, 90)).toBe(90);
    expect(clampPowerDownVests(-1, 90)).toBe(0);
  });

  it('formats weekly steem payout', () => {
    // 40 vests = 20 STEEM total -> 5 per week
    expect(formatPowerDownWeeklySteem(40, globalProps)).toBe('5.0');
  });

  it('warns when leaving less than 5 STEEM POWER reserve', () => {
    const max = getPowerDownMaxVests(baseAccount);
    const reserveVests = 10; // 5 STEEM
    expect(isPowerDownReserveWarning(max - reserveVests + 0.001, max, globalProps)).toBe(
      true
    );
    expect(isPowerDownReserveWarning(max - reserveVests - 0.001, max, globalProps)).toBe(
      false
    );
  });
});
