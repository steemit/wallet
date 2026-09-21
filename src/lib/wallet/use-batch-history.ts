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

/**
 * The (cacheKey → batch data) pair as last WRITTEN by a fetch run. Kept in a
 * ref — never read from a render closure — because the unmount cleanup must
 * persist data paired with the key of the run that produced it. The old
 * cleanup captured the deps-[cacheKey] render's state, which (a) saw the
 * mount-time empty history on a normal unmount, so pagination progress was
 * never persisted, and (b) on an in-place username switch (/@alice/transfers
 * → /@bob/transfers, same component instance) captured the NEW key with the
 * OLD user's history, writing alice's rows under bob's cache key.
 */
interface BatchCacheSnapshot {
  cacheKey: string;
  history: SteemHistoryItem[];
  nextCursor: number | null;
  totalFetched: number;
}

const HISTORY_CACHE_STALE_MS = 30_000;
const HISTORY_CACHE_MAX_AGE_MS = 120_000;

function persistSnapshot(snapshot: BatchCacheSnapshot | null): void {
  if (snapshot && snapshot.cacheKey && snapshot.history.length > 0) {
    clientCache.set(
      snapshot.cacheKey,
      {
        history: snapshot.history,
        nextCursor: snapshot.nextCursor,
        totalFetched: snapshot.totalFetched,
      },
      HISTORY_CACHE_STALE_MS,
      HISTORY_CACHE_MAX_AGE_MS
    );
  }
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
  const snapshotRef = useRef<BatchCacheSnapshot | null>(null);

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
        snapshotRef.current = null;
        return;
      }

      const cached = cacheKey ? clientCache.get<CachedData>(cacheKey) : null;
      if (cached) {
        setHistory(cached.data.history);
        setNextCursor(cached.data.nextCursor);
        setTotalFetched(cached.data.totalFetched);
        if (cached.data.nextCursor === null) setExhausted(true);
        setLoading(false);
        snapshotRef.current = {
          cacheKey,
          history: cached.data.history,
          nextCursor: cached.data.nextCursor,
          totalFetched: cached.data.totalFetched,
        };
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
        const sorted = sortByIndexAscending(accumulated);
        setHistory(sorted);
        setNextCursor(cursor);
        setExhausted(isExhausted);
        setTotalFetched(totalRaw);
        snapshotRef.current = {
          cacheKey,
          history: sorted,
          nextCursor: cursor,
          totalFetched: totalRaw,
        };
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
      // In-place identity switch (username/cacheKey changed without an
      // unmount): persist the OUTGOING run's progress under its own key while
      // the ref still holds that pairing, before the next run resets it.
      persistSnapshot(snapshotRef.current);
    };
  }, [username, cacheKey, refreshNonce, enabled]);

  // Persist pagination progress on unmount so a remount can resume where the
  // user left off. Reads the snapshot ref (current key + current data), never
  // a render closure — see BatchCacheSnapshot for why.
  useEffect(() => {
    return () => {
      persistSnapshot(snapshotRef.current);
    };
  }, []);

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

      // Merge against the snapshot ref (state pair of record) so the persisted
      // cache stays consistent with the rendered history.
      const snapshot = snapshotRef.current;
      const belongsToCurrentKey = snapshot !== null && snapshot.cacheKey === cacheKey;
      const prevHistory = belongsToCurrentKey && snapshot ? snapshot.history : [];
      const prevTotalFetched = belongsToCurrentKey && snapshot ? snapshot.totalFetched : 0;
      const merged = sortByIndexAscending([...result.filtered, ...prevHistory]);
      const mergedTotal = prevTotalFetched + result.normalizedCount;

      setHistory(merged);
      setTotalFetched(mergedTotal);

      if (result.exhausted || result.nextFrom === null) {
        setNextCursor(null);
        setExhausted(true);
      } else {
        setNextCursor(result.nextFrom);
        setExhausted(false);
      }
      snapshotRef.current = {
        cacheKey,
        history: merged,
        nextCursor: result.exhausted || result.nextFrom === null ? null : result.nextFrom,
        totalFetched: mergedTotal,
      };
    } catch (err) {
      if (requestId === requestIdRef.current) {
        console.error('Error loading more history:', err);
        setError(err instanceof Error ? err.message : 'Failed to load more');
      }
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [loadingMore, loading, exhausted, nextCursor, username, cacheKey]);

  return { history, loading, loadingMore, exhausted, totalFetched, error, loadMore };
}
