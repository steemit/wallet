'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  canFetchMoreHistory,
  nextHistoryIndex,
  paginateReversedHistory,
} from '@/lib/wallet/rewards-history';
import type { UseBatchHistoryResult } from '@/lib/wallet/use-batch-history';

type HistoryBatchState = Pick<
  UseBatchHistoryResult,
  'history' | 'loading' | 'loadingMore' | 'exhausted' | 'error' | 'loadMore'
>;

/**
 * Client-side paging (10 per page, newest first). When the user reaches the
 * oldest loaded page, "Older" fetches the next chain batch via loadMore.
 */
export function useRewardsHistoryPager(
  { history, loading, loadingMore, exhausted, error, loadMore }: HistoryBatchState,
  resetKey: string | number
) {
  const [historyIndex, setHistoryIndex] = useState(0);
  const prevResetKeyRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (prevResetKeyRef.current === null) {
      prevResetKeyRef.current = resetKey;
      return;
    }
    if (prevResetKeyRef.current === resetKey) return;
    prevResetKeyRef.current = resetKey;
    const id = window.setTimeout(() => {
      setHistoryIndex(0);
    }, 0);
    return () => window.clearTimeout(id);
  }, [resetKey]);

  const { page, canGoNewer, canGoOlder: canGoOlderLocal } = paginateReversedHistory(
    history,
    historyIndex
  );

  const canFetchMore = canFetchMoreHistory(exhausted, error);
  const canGoOlder =
    canGoOlderLocal || (canFetchMore && !loading && !loadingMore);

  const onNewer = useCallback(() => {
    if (canGoNewer) {
      setHistoryIndex((i) => nextHistoryIndex(i, 'newer'));
    }
  }, [canGoNewer]);

  const onOlder = useCallback(async () => {
    if (loading || loadingMore) return;

    if (canGoOlderLocal) {
      setHistoryIndex((i) => nextHistoryIndex(i, 'older'));
      return;
    }

    if (!canFetchMore) return;

    await loadMore();
    setHistoryIndex((i) => nextHistoryIndex(i, 'older'));
  }, [canGoOlderLocal, canFetchMore, loading, loadingMore, loadMore]);

  return {
    page,
    canGoNewer,
    canGoOlder,
    onNewer,
    onOlder,
    loadingOlder: loadingMore,
    canFetchMore,
  };
}
