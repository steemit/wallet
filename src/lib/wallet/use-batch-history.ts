'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { clientCache } from '@/lib/cache/client-cache';
import { type SteemHistoryItem } from '@/lib/wallet/normalize-history';
import { REWARDS_HISTORY_FETCH_LIMIT } from '@/lib/wallet/rewards-history';

/** Stop the initial auto-fetch loop once we have at least this many matches. */
const MIN_MATCHED_TO_STOP = 10;
/** Maximum batches pulled automatically on first load (5 × 100 = 500 ops scanned). */
const INITIAL_AUTO_BATCHES = 5;

interface BatchResult {
  filtered: SteemHistoryItem[];
  normalizedCount: number;
  nextFrom: number | null;
  exhausted: boolean;
}

interface CachedData {
  history: SteemHistoryItem[];
  nextCursor: number | null;
  totalFetched: number;
}

function sortByIndexAscending(items: SteemHistoryItem[]): SteemHistoryItem[] {
  return [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function fetchBatch(
  username: string,
  ops: string[],
  from: number | undefined,
  limit: number
): Promise<BatchResult> {
  const response = await apiClient.getHistory(username, limit, from, ops);
  if (response.error) throw new Error(response.error);
  // Server returns already-normalized, already-filtered SteemHistoryItem[]
  const items = (response.history ?? []) as SteemHistoryItem[];
  return {
    filtered: items,
    normalizedCount: items.length,
    nextFrom: response.nextFrom ?? null,
    exhausted: response.exhausted ?? false,
  };
}

export interface UseBatchHistoryOptions {
  username: string;
  cacheKey: string;
  ops: string[];
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
  ops,
  refreshNonce,
  enabled = true,
}: UseBatchHistoryOptions): UseBatchHistoryResult {
  const [history, setHistory] = useState<SteemHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [totalFetched, setTotalFetched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const opsRef = useRef(ops);

  useEffect(() => {
    opsRef.current = ops;
  }, [ops]);

  useEffect(() => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;

    (async () => {
      setLoading(true);
      setError(null);
      setHistory([]);
      setNextCursor(null);
      setExhausted(false);
      setTotalFetched(0);

      if (!username) {
        setLoading(false);
        return;
      }

      const cached = cacheKey ? clientCache.get<CachedData>(cacheKey) : null;
      if (cached) {
        setHistory(cached.data.history);
        setNextCursor(cached.data.nextCursor);
        setTotalFetched(cached.data.totalFetched);
        if (cached.data.nextCursor === null) setExhausted(true);
        setLoading(false);
        return;
      }

      const accumulated: SteemHistoryItem[] = [];
      let cursor: number | null = null; // null = "fetch from latest"
      let totalRaw = 0;
      let isExhausted = false;

      try {
        for (let i = 0; i < INITIAL_AUTO_BATCHES; i++) {
          const result = await fetchBatch(
            username,
            opsRef.current,
            cursor !== null ? cursor : undefined,
            REWARDS_HISTORY_FETCH_LIMIT
          );
          if (requestId !== requestIdRef.current) return;

          accumulated.push(...result.filtered);
          totalRaw += result.normalizedCount;

          if (result.exhausted || result.nextFrom === null) {
            isExhausted = true;
            break;
          }
          cursor = result.nextFrom;

          if (accumulated.length >= MIN_MATCHED_TO_STOP) break;
        }

        if (requestId !== requestIdRef.current) return;
        setHistory(sortByIndexAscending(accumulated));
        setNextCursor(cursor);
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
          { history, nextCursor, totalFetched },
          30_000,
          120_000
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    if (exhausted && nextCursor === null) return;

    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const from = nextCursor !== null ? nextCursor : undefined;
      const result = await fetchBatch(username, opsRef.current, from, REWARDS_HISTORY_FETCH_LIMIT);
      if (requestId !== requestIdRef.current) return;

      setHistory((prev) => sortByIndexAscending([...result.filtered, ...prev]));
      setTotalFetched((prev) => prev + result.normalizedCount);

      if (result.exhausted || result.nextFrom === null) {
        setNextCursor(null);
        setExhausted(true);
      } else {
        setNextCursor(result.nextFrom);
        setExhausted(false);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Error loading more history:', err);
        setError(err instanceof Error ? err.message : 'Failed to load more');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loadingMore, loading, exhausted, nextCursor, username]);

  return { history, loading, loadingMore, exhausted, totalFetched, error, loadMore };
}
