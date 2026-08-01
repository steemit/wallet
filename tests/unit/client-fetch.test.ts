import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clientCache } from '@/lib/cache/client-cache';
import { cachedFetch } from '@/lib/cache/client-fetch';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, headers: Record<string, string> = {}, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(data),
    headers: new Headers(headers),
  } as unknown as Response;
}

describe('cachedFetch', () => {
  beforeEach(() => {
    clientCache.clear();
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and caches fresh data', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));

    const result = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
    });

    expect(result.data).toEqual({ value: 1 });
    expect(result.stale).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const result2 = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
    });

    expect(result2.data).toEqual({ value: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch
  });

  it('returns stale data and triggers background refresh', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));

    await cachedFetch('/api/test', { staleMs: 5_000, maxAgeMs: 20_000 });

    // Advance past stale time
    vi.advanceTimersByTime(6_000);

    // Set up background refresh response
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 2 }));

    const result = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 5_000,
      maxAgeMs: 20_000,
    });

    // Returns stale data immediately
    expect(result.stale).toBe(true);
    expect(result.data).toEqual({ value: 1 });

    // Let background refresh complete
    await vi.advanceTimersByTimeAsync(0);

    // Next call should have updated data
    const refreshed = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 5_000,
      maxAgeMs: 20_000,
    });
    expect(refreshed.data).toEqual({ value: 2 });
    expect(refreshed.stale).toBe(false);
  });

  it('returns null data after maxAgeMs', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));

    await cachedFetch('/api/test', { staleMs: 5_000, maxAgeMs: 10_000 });

    vi.advanceTimersByTime(11_000);

    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 2 }));

    // Cache expired, should fetch fresh
    const result = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 5_000,
      maxAgeMs: 10_000,
    });

    expect(result.data).toEqual({ value: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips cache with noStore option', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 2 }));

    const r1 = await cachedFetch('/api/test', { staleMs: 60_000, maxAgeMs: 120_000, noStore: true });
    const r2 = await cachedFetch('/api/test', { staleMs: 60_000, maxAgeMs: 120_000, noStore: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(r1.data).toEqual({ value: 1 });
    expect(r2.data).toEqual({ value: 2 });
  });

  it('detects X-Degraded header', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ value: 1 }, { 'X-Degraded': 'true' })
    );

    const result = await cachedFetch<{ value: number }>('/api/test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
    });

    expect(result.degraded).toBe(true);
  });

  it('invalidates cache on X-Cache-Invalidate header', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ value: 1 }, { 'X-Cache-Invalidate': 'user:alice:' })
    );

    clientCache.set('user:alice:balance', 100, 60_000, 120_000);
    clientCache.set('user:bob:balance', 200, 60_000, 120_000);

    await cachedFetch('/api/test', { staleMs: 10_000, maxAgeMs: 30_000 });

    // alice entries should be invalidated (prefix match)
    expect(clientCache.get('user:alice:balance')).toBeNull();
    expect(clientCache.get('user:bob:balance')).not.toBeNull();
  });
});
