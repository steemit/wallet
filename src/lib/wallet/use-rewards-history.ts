'use client';

import { useBatchHistory, type UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';
import { filterHistoryByOpType } from '@/lib/wallet/rewards-history';

export type RewardsOpType = 'curation_reward' | 'author_reward';

export type UseRewardsHistoryResult = UseBatchHistoryResult;

/**
 * Fetch account history in batches, filter by op type, and stop auto-fetching
 * once enough matches are accumulated. The returned `loadMore` continues paging
 * older entries one batch at a time.
 */
export function useRewardsHistory(
  username: string,
  opType: RewardsOpType,
  enabled = true
): UseRewardsHistoryResult {
  return useBatchHistory({
    username,
    cacheKey: username ? `rewards:${username}:${opType}` : '',
    filter: (items) => filterHistoryByOpType(items, opType),
    enabled,
  });
}
