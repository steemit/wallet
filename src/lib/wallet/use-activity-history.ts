'use client';

import { useBatchHistory, type UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';
import {
  filterHistoryExcludingTypes,
  EXCLUDED_ACTIVITY_TYPES,
} from '@/lib/wallet/rewards-history';

export type UseActivityHistoryResult = UseBatchHistoryResult;

export function useActivityHistory(
  username: string,
  refreshNonce?: number,
  enabled = true
): UseActivityHistoryResult {
  return useBatchHistory({
    username,
    cacheKey: username ? `activity:${username}` : '',
    filter: (items) => filterHistoryExcludingTypes(items, EXCLUDED_ACTIVITY_TYPES),
    refreshNonce,
    enabled,
  });
}
