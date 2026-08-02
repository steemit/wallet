import { clientCache } from './client-cache';
import { setDegraded } from './degradation-state';

export interface CachedFetchOptions {
  /** Milliseconds until data becomes stale (eligible for background refresh) */
  staleMs: number;
  /** Milliseconds until data must be discarded entirely */
  maxAgeMs: number;
  /** Skip cache and always fetch fresh */
  noStore?: boolean;
}

export interface CachedFetchResult<T> {
  data: T;
  /** True if data was served from cache past its stale time */
  stale: boolean;
  /** True if the server indicated degraded/stale data */
  degraded?: boolean | undefined;
}

/**
 * Fetch with browser-side stale-while-revalidate caching.
 *
 * - Fresh cache → return immediately
 * - Stale cache → return immediately + background refresh
 * - No cache → fetch, cache, return
 */
export async function cachedFetch<T>(
  url: string,
  opts: CachedFetchOptions
): Promise<CachedFetchResult<T>> {
  if (opts.noStore) {
    const res = await fetch(url, { cache: 'no-store' });
    return { data: await res.json(), stale: false };
  }

  const cached = clientCache.get<T>(url);
  if (cached && !cached.stale) {
    return { data: cached.data, stale: false };
  }

  // Stale but usable → return old data + refresh in background
  if (cached) {
    backgroundRefresh(url, opts);
    return { data: cached.data, stale: true };
  }

  // No cache at all → must wait for fetch
  const res = await fetch(url);
  const data = (await res.json()) as T;
  const isDegraded = res.headers.get('X-Degraded') === 'true';
  handleCacheInvalidation(res);
  setDegraded(isDegraded);
  // Only cache successful responses — never cache errors (4xx/5xx) or the user
  // gets stuck on a stale error page even after the backend recovers.
  if (res.ok) {
    clientCache.set(url, data, opts.staleMs, opts.maxAgeMs);
  }
  return { data, stale: false, degraded: isDegraded || undefined };
}

function backgroundRefresh(url: string, opts: CachedFetchOptions): void {
  fetch(url)
    .then(async (res) => {
      const data = await res.json();
      const isDegraded = res.headers.get('X-Degraded') === 'true';
      handleCacheInvalidation(res);
      setDegraded(isDegraded);
      // Only refresh-cache on success — a transient error must not replace
      // good cached data with an error body.
      if (res.ok) {
        clientCache.set(url, data, opts.staleMs, opts.maxAgeMs);
      }
    })
    .catch(() => {});
}

function handleCacheInvalidation(res: Response): void {
  const prefix = res.headers.get('X-Cache-Invalidate');
  if (prefix) clientCache.invalidate(prefix);
}
