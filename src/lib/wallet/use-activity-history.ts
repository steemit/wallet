'use client';

import { useBatchHistory, type UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';
import { ACTIVITY_OP_TYPES } from '@/lib/steem/history-ops';
import { normalizeSteemUsername } from '@/lib/steem/username';

export type UseActivityHistoryResult = UseBatchHistoryResult;

export function useActivityHistory(
  username: string,
  refreshNonce?: number,
  enabled = true
): UseBatchHistoryResult {
  return useBatchHistory({
    username,
    // Normalize the cache-key component: /@Alice and /@alice must share ONE
    // L1 entry for the same account instead of duplicating.
    cacheKey: username ? `activity:${normalizeSteemUsername(username)}` : '',
    ops: ACTIVITY_OP_TYPES,
    refreshNonce,
    enabled,
  });
}
