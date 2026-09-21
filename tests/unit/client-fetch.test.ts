import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { clientCache } from '@/lib/cache/client-cache';
import { cachedFetch } from '@/lib/cache/client-fetch';
import { setDegraded, subscribeToDegradation } from '@/lib/cache/degradation-state';

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
    setDegraded(false);
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

  it('notifies degradation subscribers when a response carries X-Degraded', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDegradation(listener);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ value: 1 }, { 'X-Degraded': 'true' })
    );

    await cachedFetch('/api/degraded-subscriber-test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
    });

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
    setDegraded(false);
  });

  it('notifies subscribers of recovery when a later response is healthy', async () => {
    setDegraded(true);
    const listener = vi.fn();
    const unsubscribe = subscribeToDegradation(listener);
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));

    await cachedFetch('/api/healthy-subscriber-test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
    });

    expect(listener).toHaveBeenCalledWith(false);
    expect(listener).not.toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('reads X-Degraded on noStore fetches too', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDegradation(listener);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ value: 1 }, { 'X-Degraded': 'true' })
    );

    const result = await cachedFetch('/api/nostore-degraded-test', {
      staleMs: 10_000,
      maxAgeMs: 30_000,
      noStore: true,
    });

    expect(result.degraded).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
    setDegraded(false);
  });

  it('background refresh notifies subscribers with the fresh degradation state', async () => {
    // Seed the cache with a healthy response.
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: 1 }));
    await cachedFetch('/api/bg-degraded-test', { staleMs: 5_000, maxAgeMs: 20_000 });

    vi.advanceTimersByTime(6_000);

    const listener = vi.fn();
    const unsubscribe = subscribeToDegradation(listener);
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ value: 2 }, { 'X-Degraded': 'true' })
    );

    // Stale hit returns immediately; the refresh runs in the background.
    await cachedFetch('/api/bg-degraded-test', { staleMs: 5_000, maxAgeMs: 20_000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
    setDegraded(false);
  });
});
