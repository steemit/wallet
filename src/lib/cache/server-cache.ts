// Server-side stale-while-error cache wrapper
// Uses Redis when available, falls back to direct fetcher execution

import { cacheGet, cacheSet, getRedis } from './redis';
import { isSteemKnownDown } from './health-monitor';

export interface WithCacheResult<T> {
  data: T;
  degraded: boolean;
  staleAge?: number;
}

/**
 * Per-process in-flight promise map (single-flight). Concurrent cache misses
 * for the same key — e.g. a TTL expiry storm on a short-TTL route — share ONE
 * upstream fetch instead of each request fanning out to the RPC separately.
 * Safe under Next.js: each route handler runs in one Node process per
 * instance, so this map is only consulted by genuinely concurrent callers.
 */
const inFlightFetches = new Map<string, Promise<WithCacheResult<unknown>>>();

function runSingleFlight<T>(
  key: string,
  task: () => Promise<WithCacheResult<T>>
): Promise<WithCacheResult<T>> {
  const pending = inFlightFetches.get(key);
  if (pending) return pending as Promise<WithCacheResult<T>>;

  const promise = task().finally(() => {
    // Identity check: a newer flight may already have replaced this entry.
    if (inFlightFetches.get(key) === promise) inFlightFetches.delete(key);
  });
  inFlightFetches.set(key, promise);
  return promise as Promise<WithCacheResult<T>>;
}

/**
 * Execute a fetcher with stale-while-error caching:
 * 1. Check Redis for fresh data → return immediately
 * 2. Steem known down → skip the RPC entirely: serve stale if available,
 *    otherwise throw (caller returns 503) — a known-down node is never
 *    hammered by cache misses
 * 3. Try fetcher (single-flight) → on success, cache and return
 * 4. On fetcher failure → return stale data if available
 * 5. No stale data → throw (caller handles 503)
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  staleTtl: number,
  fetcher: () => Promise<T>
): Promise<WithCacheResult<T>> {
  const redis = getRedis();

  // No Redis → run the fetcher directly, still single-flighted so concurrent
  // identical requests do not each hit the upstream.
  if (!redis) {
    return runSingleFlight(key, async () => ({ data: await fetcher(), degraded: false }));
  }

  // Check for fresh cached data
  const cached = await cacheGet<T>(key, ttl, staleTtl);
  if (cached && !cached.degraded) {
    return { data: cached.data, degraded: false };
  }

  // If Steem is known to be down, skip the RPC attempt entirely: serve stale
  // immediately when we have it, and fail fast (no upstream hammering) when
  // we do not — the caller turns the throw into a 503 degraded response.
  if (await isSteemKnownDown()) {
    if (cached) {
      return {
        data: cached.data,
        degraded: true,
        ...(cached.staleAge !== undefined && { staleAge: cached.staleAge }),
      };
    }
    throw new Error('Steem upstream is known down and no cached data is available');
  }

  // Try a fresh fetch; concurrent misses for this key share one flight.
  return runSingleFlight(key, async () => {
    try {
      const fresh = await fetcher();
      await cacheSet(key, ttl, staleTtl, fresh);
      return { data: fresh, degraded: false };
    } catch (error) {
      // Fresh fetch failed — serve stale if available
      if (cached) {
        return {
          data: cached.data,
          degraded: true,
          ...(cached.staleAge !== undefined && { staleAge: cached.staleAge }),
        };
      }
      throw error;
    }
  });
}
