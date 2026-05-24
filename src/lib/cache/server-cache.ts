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
 * Execute a fetcher with stale-while-error caching:
 * 1. Check Redis for fresh data → return immediately
 * 2. Try fetcher → on success, cache and return
 * 3. On fetcher failure → return stale data if available
 * 4. No stale data → throw (caller handles 503)
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  staleTtl: number,
  fetcher: () => Promise<T>
): Promise<WithCacheResult<T>> {
  const redis = getRedis();

  // No Redis → just run the fetcher
  if (!redis) {
    const data = await fetcher();
    return { data, degraded: false };
  }

  // Check for fresh cached data
  const cached = await cacheGet<T>(key, ttl, staleTtl);
  if (cached && !cached.degraded) {
    return { data: cached.data, degraded: false };
  }

  // If Steem is known to be down, skip RPC attempt and serve stale immediately
  if (await isSteemKnownDown()) {
    if (cached) {
      return { data: cached.data, degraded: true, ...(cached.staleAge !== undefined && { staleAge: cached.staleAge }) };
    }
  }

  // Try fresh fetch
  try {
    const fresh = await fetcher();
    await cacheSet(key, ttl, staleTtl, fresh);
    return { data: fresh, degraded: false };
  } catch (error) {
    // Fresh fetch failed — serve stale if available
    if (cached) {
      return { data: cached.data, degraded: true, ...(cached.staleAge !== undefined && { staleAge: cached.staleAge }) };
    }
    throw error;
  }
}
