import { describe, expect, it } from 'vitest';
import { getCurrentSteemPowerApr } from '@/lib/wallet/sp-apr';
import { formatTimeUntil } from '@/lib/wallet/format-time-ago';

describe('getCurrentSteemPowerApr (legacy getCurrentApr parity)', () => {
  it('returns null when required props are missing', () => {
    expect(
      getCurrentSteemPowerApr({
        total_vesting_shares: '1000.000000 VESTS',
        total_vesting_fund_steem: '1000.000 STEEM',
      })
    ).toBeNull();
  });

  it('computes the APR as a percentage number', () => {
    // Mirrors live-chain magnitudes: 618M virtual supply, 200M vesting fund,
    // reward percent 15%, head block ~109M.
    const apr = getCurrentSteemPowerApr({
      total_vesting_shares: '400000000000.000000 VESTS',
      total_vesting_fund_steem: '200660237.295 STEEM',
      head_block_number: 108976681,
      virtual_supply: '618060261.781 STEEM',
      vesting_reward_percent: 1500,
    });
    expect(apr).not.toBeNull();
    // Reasonable band for the current era (inflation ~5.4%).
    expect(apr!).toBeGreaterThan(2);
    expect(apr!).toBeLessThan(4);
  });

  it('floors inflation at 0.95% for far-future blocks', () => {
    const apr = getCurrentSteemPowerApr({
      total_vesting_shares: '1.000000 VESTS',
      total_vesting_fund_steem: '100.000 STEEM',
      head_block_number: 10_000_000_000,
      virtual_supply: '100.000 STEEM',
      vesting_reward_percent: 1500,
    });
    // 100 * 0.95 * 0.15 / 100 = 0.1425
    expect(apr).toBeCloseTo(0.1425, 4);
  });
});

describe('formatTimeUntil', () => {
  it('renders future times relatively', () => {
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 60_000).toISOString();
    expect(formatTimeUntil(future)).toBe('in 3d');
  });

  it('handles timestamps without trailing Z', () => {
    const future = new Date(Date.now() + 2 * 3600 * 1000 + 60_000).toISOString().replace('Z', '');
    expect(formatTimeUntil(future)).toBe('in 2h');
  });

  it('falls back to past formatting for past dates', () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    expect(formatTimeUntil(past)).toBe('1h ago');
  });
});
