'use client';

import { useBatchHistory, type UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';

export type RewardsOpType = 'curation_reward' | 'author_reward';

export type UseRewardsHistoryResult = UseBatchHistoryResult;

/**
 * Fetch account history in batches, filtered server-side to a single reward op
 * type, stopping auto-fetch once enough matches are accumulated. The returned
 * `loadMore` continues paging older entries one batch at a time.
 */
export function useRewardsHistory(
  username: string,
  opType: RewardsOpType,
  enabled = true
): UseRewardsHistoryResult {
  return useBatchHistory({
    username,
    cacheKey: username ? `rewards:${username}:${opType}` : '',
    ops: [opType],
    enabled,
  });
}
