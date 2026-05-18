import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

export const REWARDS_HISTORY_PAGE_SIZE = 10;
/** Steemit/Jussi account history endpoints cap batch size at 100. */
export const REWARDS_HISTORY_FETCH_LIMIT = 100;
const ONE_DAY_MS = 86400 * 1000;

export function filterHistoryByOpType(
  items: SteemHistoryItem[],
  opType: string
): SteemHistoryItem[] {
  return items.filter((item) => item.op[0] === opType);
}

function timestampMs(timestamp: string): number {
  // Steem RPC returns UTC timestamps without a `Z` suffix; appending it
  // prevents the local timezone from shifting the parsed instant.
  const iso = timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`;
  return new Date(iso).getTime();
}

/** Sum curation_reward VESTS in the last 7 days (legacy CurationRewards rewardsWeek). */
export function sumCurationRewardsLastWeek(
  items: SteemHistoryItem[],
  now: Date = new Date()
): number {
  const yesterday = now.getTime() - ONE_DAY_MS;
  const lastWeek = now.getTime() - 7 * ONE_DAY_MS;
  let rewardsWeek = 0;

  for (const item of items) {
    if (item.op[0] !== 'curation_reward') continue;
    const ts = timestampMs(item.timestamp);
    const vest = parseAssetAmount(item.op[1].reward as string | undefined);
    if (ts > yesterday) {
      rewardsWeek += vest;
    } else if (ts > lastWeek) {
      rewardsWeek += vest;
    }
  }

  return rewardsWeek;
}

export interface AuthorRewardsWeekTotals {
  vests: number;
  steem: number;
  sbd: number;
}

/** Sum author_reward payouts in the last 7 days (legacy AuthorRewards week totals). */
export function sumAuthorRewardsLastWeek(
  items: SteemHistoryItem[],
  now: Date = new Date()
): AuthorRewardsWeekTotals {
  const lastWeek = now.getTime() - 7 * ONE_DAY_MS;
  const totals: AuthorRewardsWeekTotals = { vests: 0, steem: 0, sbd: 0 };

  for (const item of items) {
    if (item.op[0] !== 'author_reward') continue;
    const ts = timestampMs(item.timestamp);
    if (ts <= lastWeek) continue;

    const data = item.op[1];
    totals.vests += parseAssetAmount(data.vesting_payout as string | undefined);
    totals.steem += parseAssetAmount(data.steem_payout as string | undefined);
    totals.sbd += parseAssetAmount(data.sbd_payout as string | undefined);
  }

  return totals;
}

export interface RewardsHistoryPageResult<T> {
  page: T[];
  total: number;
  canGoNewer: boolean;
  canGoOlder: boolean;
}

/**
 * Paginate reward history (newest first), matching legacy historyIndex / limitedIndex logic.
 */
export function paginateReversedHistory<T>(
  items: T[],
  historyIndex: number,
  pageSize: number = REWARDS_HISTORY_PAGE_SIZE
): RewardsHistoryPageResult<T> {
  const total = items.length;
  const limitedIndex = Math.min(historyIndex, Math.max(0, total - pageSize));
  let currentIndex = -1;
  const reversed = [...items].reverse();
  const page = reversed.filter(() => {
    currentIndex += 1;
    return currentIndex >= limitedIndex && currentIndex < limitedIndex + pageSize;
  });

  return {
    page,
    total,
    canGoNewer: historyIndex > 0,
    canGoOlder: historyIndex < total - pageSize,
  };
}

export function nextHistoryIndex(
  historyIndex: number,
  direction: 'newer' | 'older',
  pageSize: number = REWARDS_HISTORY_PAGE_SIZE
): number {
  const delta = direction === 'older' ? pageSize : -pageSize;
  return Math.max(0, historyIndex + delta);
}
