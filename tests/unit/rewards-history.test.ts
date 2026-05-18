import { describe, expect, it } from 'vitest';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';
import {
  filterHistoryByOpType,
  canFetchMoreHistory,
  nextHistoryIndex,
  paginateReversedHistory,
  sumAuthorRewardsLastWeek,
  sumCurationRewardsLastWeek,
} from '@/lib/wallet/rewards-history';

function item(
  opType: string,
  timestamp: string,
  payload: Record<string, unknown> = {}
): SteemHistoryItem {
  return {
    op: [opType, payload],
    timestamp,
    block: 1,
    trx_id: `trx-${timestamp}`,
  };
}

describe('rewards-history', () => {
  const now = new Date('2026-05-18T12:00:00Z');

  it('filters by operation type', () => {
    const items = [
      item('transfer', '2026-05-18T10:00:00'),
      item('curation_reward', '2026-05-18T11:00:00', { reward: '1.000000 VESTS' }),
    ];
    expect(filterHistoryByOpType(items, 'curation_reward')).toHaveLength(1);
  });

  it('parses RPC timestamps as UTC even without Z suffix', () => {
    // 2026-05-11T13:00:00 UTC == now - (7d - 1h), still inside the window.
    // Without the Z fix this would be parsed as local time and the assertion
    // would only pass in UTC environments.
    const items = [
      item('curation_reward', '2026-05-11T13:00:00', { reward: '3.000000 VESTS' }),
    ];
    expect(sumCurationRewardsLastWeek(items, now)).toBe(3);
  });

  it('sums curation rewards in the last week', () => {
    const items = [
      item('curation_reward', '2026-05-17T10:00:00', { reward: '2.000000 VESTS' }),
      item('curation_reward', '2026-05-10T10:00:00', { reward: '5.000000 VESTS' }),
      item('curation_reward', '2026-05-01T10:00:00', { reward: '9.000000 VESTS' }),
    ];
    expect(sumCurationRewardsLastWeek(items, now)).toBe(2);
  });

  it('sums author rewards in the last week', () => {
    const items = [
      item('author_reward', '2026-05-17T10:00:00', {
        vesting_payout: '1.000000 VESTS',
        steem_payout: '0.100 STEEM',
        sbd_payout: '0.200 SBD',
      }),
      item('author_reward', '2026-05-01T10:00:00', {
        vesting_payout: '9.000000 VESTS',
        steem_payout: '0.000 STEEM',
        sbd_payout: '0.000 SBD',
      }),
    ];
    const totals = sumAuthorRewardsLastWeek(items, now);
    expect(totals.vests).toBe(1);
    expect(totals.steem).toBeCloseTo(0.1);
    expect(totals.sbd).toBeCloseTo(0.2);
  });

  it('paginates reversed history like legacy (newest first)', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item('curation_reward', `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00`)
    );

    const first = paginateReversedHistory(items, 0);
    expect(first.page).toHaveLength(10);
    expect(first.canGoNewer).toBe(false);
    expect(first.canGoOlder).toBe(true);

    const olderIndex = nextHistoryIndex(0, 'older');
    const second = paginateReversedHistory(items, olderIndex);
    // Legacy caps limitedIndex at length - pageSize, so the second page still shows 10 rows (overlapping window).
    expect(second.page).toHaveLength(10);
    expect(second.canGoNewer).toBe(true);
    expect(second.canGoOlder).toBe(olderIndex < items.length - 10);
  });

  it('handles an empty history', () => {
    const result = paginateReversedHistory([], 0);
    expect(result.page).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.canGoNewer).toBe(false);
    expect(result.canGoOlder).toBe(false);
  });

  it('clamps when historyIndex exceeds total - pageSize', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item('curation_reward', `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00`)
    );
    const overshot = paginateReversedHistory(items, 999);
    // limitedIndex pinned to total - pageSize = 2 → page shows items 2..11 reversed.
    expect(overshot.page).toHaveLength(10);
    expect(overshot.canGoOlder).toBe(false);
    expect(overshot.canGoNewer).toBe(true);
  });

  it('returns all items and disables navigation when items.length < pageSize', () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      item('curation_reward', `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00`)
    );
    const result = paginateReversedHistory(items, 0);
    expect(result.page).toHaveLength(4);
    expect(result.canGoNewer).toBe(false);
    expect(result.canGoOlder).toBe(false);
  });

  it('canFetchMoreHistory is true until exhausted without error', () => {
    expect(canFetchMoreHistory(false, null)).toBe(true);
    expect(canFetchMoreHistory(true, null)).toBe(false);
    expect(canFetchMoreHistory(true, 'timeout')).toBe(true);
  });

  it('nextHistoryIndex never returns negative', () => {
    expect(nextHistoryIndex(0, 'newer')).toBe(0);
    expect(nextHistoryIndex(5, 'newer')).toBe(0);
    expect(nextHistoryIndex(20, 'newer')).toBe(10);
    expect(nextHistoryIndex(0, 'older')).toBe(10);
  });

  it('treats missing reward asset as zero', () => {
    const items = [
      item('curation_reward', '2026-05-17T10:00:00', {}),
      item('curation_reward', '2026-05-17T11:00:00', { reward: undefined }),
      item('curation_reward', '2026-05-17T12:00:00', { reward: '1.000000 VESTS' }),
    ];
    expect(sumCurationRewardsLastWeek(items, now)).toBe(1);
  });

  it('treats author_reward with missing payouts as zero', () => {
    const items = [
      item('author_reward', '2026-05-17T10:00:00', {}),
      item('author_reward', '2026-05-17T11:00:00', {
        vesting_payout: '2.000000 VESTS',
      }),
    ];
    const totals = sumAuthorRewardsLastWeek(items, now);
    expect(totals.vests).toBe(2);
    expect(totals.steem).toBe(0);
    expect(totals.sbd).toBe(0);
  });
});
