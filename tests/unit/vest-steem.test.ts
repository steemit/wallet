import { describe, expect, it } from 'vitest';
import {
  formatDelegatedSteemPowerDisplay,
  formatSteemPowerDisplay,
  formatVestsAsset,
  netDelegatedSteemPower,
  steemPowerFromVests,
  steemPowerFromVestsString,
  steemPowerToVestsAsset,
  vestsFromSteemPower,
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

  it('converts steem power to vests using chain ratio', () => {
    expect(vestsFromSteemPower(5, globalProps)).toBe(10);
  });

  it('formats vests asset strings for chain ops', () => {
    expect(formatVestsAsset(10)).toBe('10.000000 VESTS');
  });

  it('converts steem power input to vests asset strings', () => {
    expect(steemPowerToVestsAsset(5, globalProps)).toBe('10.000000 VESTS');
  });

  it('round-trips steem power and vests', () => {
    const vests = vestsFromSteemPower(12.345, globalProps);
    expect(steemPowerFromVests(vests, globalProps)).toBeCloseTo(12.345, 6);
  });
});

// Legacy parity (review finding G-3): legacy `delegatedSteem`
// (wallet-legacy src/app/utils/StateFunctions.js:63-78) shows the NET of
// delegated minus received, and UserWallet.jsx:659-661 formats it as
// `(delegated_steem < 0 ? '+' : '') + (-delegated_steem).toFixed(3)`.
// With this fixture ratio (100 VESTS = 50 STEEM), 10 VESTS net = 5 SP.
describe('net delegated STEEM POWER (legacy delegatedSteem parity)', () => {
  const delegation = (delegated: string, received: string) => ({
    delegated_vesting_shares: delegated,
    received_vesting_shares: received,
  });

  it('is positive when only delegating out', () => {
    expect(netDelegatedSteemPower(delegation('10.000000 VESTS', '0.000000 VESTS'), globalProps)).toBe(5);
    expect(formatDelegatedSteemPowerDisplay(5)).toBe('-5.000');
  });

  it('is negative when only receiving (must not read as "not delegated")', () => {
    expect(netDelegatedSteemPower(delegation('0.000000 VESTS', '10.000000 VESTS'), globalProps)).toBe(-5);
    expect(formatDelegatedSteemPowerDisplay(-5)).toBe('+5.000');
  });

  it('nets delegated and received against each other', () => {
    // 40 VESTS out minus 15 VESTS in = 25 VESTS net out = 12.5 SP.
    expect(
      netDelegatedSteemPower(delegation('40.000000 VESTS', '15.000000 VESTS'), globalProps)
    ).toBe(12.5);
    // 15 VESTS out minus 40 VESTS in = net received.
    expect(
      netDelegatedSteemPower(delegation('15.000000 VESTS', '40.000000 VESTS'), globalProps)
    ).toBe(-12.5);
    // Equal in/out nets to exactly zero ("not currently delegated" state).
    expect(
      netDelegatedSteemPower(delegation('10.000000 VESTS', '10.000000 VESTS'), globalProps)
    ).toBe(0);
  });

  it('treats unparseable/empty fields as zero', () => {
    expect(
      netDelegatedSteemPower(delegation('', ''), globalProps)
    ).toBe(0);
  });

  it('formats thousands separators like legacy numberWithCommas', () => {
    expect(formatDelegatedSteemPowerDisplay(-1234.5)).toBe('+1,234.500');
    expect(formatDelegatedSteemPowerDisplay(1234.5)).toBe('-1,234.500');
  });
});
