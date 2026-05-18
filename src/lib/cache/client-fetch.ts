import { clientCache } from './client-cache';

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
    const res = await fetch(url);
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
  handleCacheInvalidation(res);
  clientCache.set(url, data, opts.staleMs, opts.maxAgeMs);
  return { data, stale: false, degraded: res.headers.get('X-Degraded') === 'true' || undefined };
}

function backgroundRefresh(url: string, opts: CachedFetchOptions): void {
  fetch(url)
    .then(async (res) => {
      const data = await res.json();
      handleCacheInvalidation(res);
      clientCache.set(url, data, opts.staleMs, opts.maxAgeMs);
    })
    .catch(() => {});
}

function handleCacheInvalidation(res: Response): void {
  const prefix = res.headers.get('X-Cache-Invalidate');
  if (prefix) clientCache.invalidate(prefix);
}
