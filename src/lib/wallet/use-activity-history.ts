'use client';

import { useBatchHistory, type UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';
import { ACTIVITY_OP_TYPES } from '@/lib/steem/history-ops';

export type UseActivityHistoryResult = UseBatchHistoryResult;

export function useActivityHistory(
  username: string,
  refreshNonce?: number,
  enabled = true
): UseActivityHistoryResult {
  return useBatchHistory({
    username,
    cacheKey: username ? `activity:${username}` : '',
    ops: ACTIVITY_OP_TYPES,
    refreshNonce,
    enabled,
  });
}
