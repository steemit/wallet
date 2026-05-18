'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import {
  normalizeSteemHistoryList,
  type SteemHistoryItem,
} from '@/lib/wallet/normalize-history';
import {
  filterHistoryByOpType,
  REWARDS_HISTORY_FETCH_LIMIT,
} from '@/lib/wallet/rewards-history';

/** Stop the initial auto-fetch loop once we have at least this many matches. */
export const MIN_MATCHED_TO_STOP = 10;
/** Maximum batches pulled automatically on first load (5 × 100 = 500 ops). */
export const INITIAL_AUTO_BATCHES = 5;

function oldestIndexIn(items: SteemHistoryItem[]): number | null {
  let oldest: number | null = null;
  for (const it of items) {
    if (typeof it.index === 'number') {
      if (oldest === null || it.index < oldest) oldest = it.index;
    }
  }
  return oldest;
}

function sortByIndexAscending(items: SteemHistoryItem[]): SteemHistoryItem[] {
  return [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

interface BatchResult {
  filtered: SteemHistoryItem[];
  normalizedCount: number;
  oldestIn: number | null;
}

async function fetchBatch(
  username: string,
  opType: string,
  from: number | undefined,
  limit: number
): Promise<BatchResult> {
  const response = await apiClient.getHistory(username, limit, from);
  if (response.error) throw new Error(response.error);
  const normalized = normalizeSteemHistoryList(response.history || []);
  return {
    filtered: filterHistoryByOpType(normalized, opType),
    normalizedCount: normalized.length,
    oldestIn: oldestIndexIn(normalized),
  };
}

export type RewardsOpType = 'curation_reward' | 'author_reward';

export interface UseRewardsHistoryResult {
  history: SteemHistoryItem[];
  loading: boolean;
  loadingMore: boolean;
  exhausted: boolean;
  totalFetched: number;
  error: string | null;
  loadMore: () => Promise<void>;
}

/**
 * Fetch account history in batches of {@link REWARDS_HISTORY_FETCH_LIMIT},
 * filter by op type, and stop auto-fetching once {@link MIN_MATCHED_TO_STOP}
 * matches are accumulated or {@link INITIAL_AUTO_BATCHES} batches are pulled.
 * The returned `loadMore` continues paging older entries one batch at a time.
 */
export function useRewardsHistory(
  username: string,
  opType: RewardsOpType
): UseRewardsHistoryResult {
  const [history, setHistory] = useState<SteemHistoryItem[]>([]);
  const [oldestIndex, setOldestIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [totalFetched, setTotalFetched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!username) {
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    setHistory([]);
    setOldestIndex(null);
    setExhausted(false);
    setTotalFetched(0);

    (async () => {
      const accumulated: SteemHistoryItem[] = [];
      let localOldest: number | null = null;
      let totalRaw = 0;
      let isExhausted = false;

      try {
        for (let i = 0; i < INITIAL_AUTO_BATCHES; i++) {
          const from = localOldest !== null ? localOldest - 1 : undefined;
          if (from !== undefined && from < 0) {
            isExhausted = true;
            break;
          }
          const limit =
            from !== undefined
              ? Math.min(REWARDS_HISTORY_FETCH_LIMIT, Math.max(1, from))
              : REWARDS_HISTORY_FETCH_LIMIT;

          const result = await fetchBatch(username, opType, from, limit);
          if (requestId !== requestIdRef.current) return;

          accumulated.push(...result.filtered);
          totalRaw += result.normalizedCount;
          if (result.oldestIn === null) {
            // No index information — cannot paginate further.
            isExhausted = true;
            break;
          }
          localOldest =
            localOldest === null
              ? result.oldestIn
              : Math.min(localOldest, result.oldestIn);
          if (localOldest <= 0 || result.normalizedCount === 0) {
            isExhausted = true;
            break;
          }
          if (accumulated.length >= MIN_MATCHED_TO_STOP) break;
        }

        if (requestId !== requestIdRef.current) return;
        setHistory(sortByIndexAscending(accumulated));
        setOldestIndex(localOldest);
        setExhausted(isExhausted);
        setTotalFetched(totalRaw);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.error(`Error fetching ${opType} history:`, err);
        setError(err instanceof Error ? err.message : 'Failed to fetch history');
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    })();

    return () => {
      // Bump the request id so any in-flight batch resolves into a no-op.
      requestIdRef.current += 1;
    };
  }, [username, opType]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || exhausted) return;
    if (oldestIndex === null || oldestIndex <= 0) {
      setExhausted(true);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    try {
      const from = oldestIndex - 1;
      const limit = Math.min(REWARDS_HISTORY_FETCH_LIMIT, Math.max(1, from));
      const result = await fetchBatch(username, opType, from, limit);
      if (requestId !== requestIdRef.current) return;

      setHistory((prev) => sortByIndexAscending([...result.filtered, ...prev]));
      setTotalFetched((prev) => prev + result.normalizedCount);
      if (result.oldestIn !== null) {
        setOldestIndex(result.oldestIn);
        if (result.oldestIn <= 0) setExhausted(true);
      } else {
        setExhausted(true);
      }
      if (result.normalizedCount === 0) setExhausted(true);
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error(`Error loading more ${opType} history:`, err);
        setError(err instanceof Error ? err.message : 'Failed to load more');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loadingMore, loading, exhausted, oldestIndex, username, opType]);

  return { history, loading, loadingMore, exhausted, totalFetched, error, loadMore };
}
