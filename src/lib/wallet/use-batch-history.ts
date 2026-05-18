'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { clientCache } from '@/lib/cache/client-cache';
import {
  normalizeSteemHistoryList,
  type SteemHistoryItem,
} from '@/lib/wallet/normalize-history';
import { REWARDS_HISTORY_FETCH_LIMIT } from '@/lib/wallet/rewards-history';

/** Stop the initial auto-fetch loop once we have at least this many matches. */
const MIN_MATCHED_TO_STOP = 10;
/** Maximum batches pulled automatically on first load (5 × 100 = 500 ops). */
const INITIAL_AUTO_BATCHES = 5;

type HistoryFilter = (items: SteemHistoryItem[]) => SteemHistoryItem[];

interface BatchResult {
  filtered: SteemHistoryItem[];
  normalizedCount: number;
  oldestIn: number | null;
}

interface CachedData {
  history: SteemHistoryItem[];
  oldestIndex: number | null;
  totalFetched: number;
}

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

async function fetchBatch(
  username: string,
  filter: HistoryFilter,
  from: number | undefined,
  limit: number
): Promise<BatchResult> {
  const response = await apiClient.getHistory(username, limit, from);
  if (response.error) throw new Error(response.error);
  const normalized = normalizeSteemHistoryList(response.history || []);
  return {
    filtered: filter(normalized),
    normalizedCount: normalized.length,
    oldestIn: oldestIndexIn(normalized),
  };
}

export interface UseBatchHistoryOptions {
  username: string;
  cacheKey: string;
  filter: HistoryFilter;
  refreshNonce?: number | undefined;
  /** When false, no fetch runs (e.g. until client mount). Default true. */
  enabled?: boolean;
}

export interface UseBatchHistoryResult {
  history: SteemHistoryItem[];
  loading: boolean;
  loadingMore: boolean;
  exhausted: boolean;
  totalFetched: number;
  error: string | null;
  loadMore: () => Promise<void>;
}

export function useBatchHistory({
  username,
  cacheKey,
  filter,
  refreshNonce,
  enabled = true,
}: UseBatchHistoryOptions): UseBatchHistoryResult {
  const [history, setHistory] = useState<SteemHistoryItem[]>([]);
  const [oldestIndex, setOldestIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [totalFetched, setTotalFetched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const filterRef = useRef(filter);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;

    (async () => {
      setLoading(true);
      setError(null);
      setHistory([]);
      setOldestIndex(null);
      setExhausted(false);
      setTotalFetched(0);

      if (!username) {
        setLoading(false);
        return;
      }

      const cached = cacheKey
        ? clientCache.get<CachedData>(cacheKey)
        : null;
      if (cached) {
        setHistory(cached.data.history);
        setOldestIndex(cached.data.oldestIndex);
        setTotalFetched(cached.data.totalFetched);
        if (cached.data.oldestIndex !== null && cached.data.oldestIndex <= 0) {
          setExhausted(true);
        }
        setLoading(false);
        return;
      }

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

          const result = await fetchBatch(username, filterRef.current, from, limit);
          if (requestId !== requestIdRef.current) return;

          accumulated.push(...result.filtered);
          totalRaw += result.normalizedCount;
          if (result.oldestIn === null) {
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
        console.error('Error fetching history:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch history');
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    })();

    return () => {
      requestIdRef.current += 1;
    };
  }, [username, cacheKey, refreshNonce, enabled]);

  useEffect(() => {
    return () => {
      if (cacheKey && history.length > 0) {
        clientCache.set(
          cacheKey,
          { history, oldestIndex, totalFetched },
          30_000,
          120_000
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    if (oldestIndex !== null && oldestIndex <= 0) {
      setExhausted(true);
      return;
    }
    if (exhausted && oldestIndex !== null) return;

    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const isRetry = oldestIndex === null;
      const from = isRetry ? undefined : oldestIndex - 1;
      const limit =
        from !== undefined
          ? Math.min(REWARDS_HISTORY_FETCH_LIMIT, Math.max(1, from))
          : REWARDS_HISTORY_FETCH_LIMIT;
      const result = await fetchBatch(username, filterRef.current, from, limit);
      if (requestId !== requestIdRef.current) return;

      setHistory((prev) => sortByIndexAscending([...result.filtered, ...prev]));
      setTotalFetched((prev) => prev + result.normalizedCount);
      if (result.oldestIn !== null) {
        setOldestIndex(result.oldestIn);
        setExhausted(result.oldestIn <= 0 || result.normalizedCount === 0);
      } else {
        setExhausted(true);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Error loading more history:', err);
        setError(err instanceof Error ? err.message : 'Failed to load more');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loadingMore, loading, exhausted, oldestIndex, username]);

  return { history, loading, loadingMore, exhausted, totalFetched, error, loadMore };
}
