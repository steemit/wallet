import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis module at the boundary
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDeleteByPrefix = vi.fn();
const mockGetRedis = vi.fn();
const mockIsSteemKnownDown = vi.fn();

vi.mock('@/lib/cache/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDeleteByPrefix: (...args: unknown[]) => mockCacheDeleteByPrefix(...args),
  getRedis: () => mockGetRedis(),
}));

vi.mock('@/lib/cache/health-monitor', () => ({
  isSteemKnownDown: () => mockIsSteemKnownDown(),
}));

import { withCache } from '@/lib/cache/server-cache';

describe('withCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Redis is available and Steem's health is unknown (not down).
    mockGetRedis.mockReturnValue({});
    mockIsSteemKnownDown.mockResolvedValue(false);
  });

  it('returns fresh data from Redis cache', async () => {
    mockCacheGet.mockResolvedValueOnce({
      data: { x: 1 },
      degraded: false,
    });

    const result = await withCache('key', 10, 300, () => Promise.resolve({ x: 2 }));
    expect(result.data).toEqual({ x: 1 });
    expect(result.degraded).toBe(false);
  });

  it('calls fetcher and caches on cache miss', async () => {
    mockCacheGet.mockResolvedValueOnce(null); // cache miss

    const fetcher = vi.fn().mockResolvedValue({ x: 42 });

    const result = await withCache('key', 10, 300, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.data).toEqual({ x: 42 });
    expect(result.degraded).toBe(false);
    expect(mockCacheSet).toHaveBeenCalledWith('key', 10, 300, { x: 42 });
  });

  it('returns stale data when fetcher fails', async () => {
    mockCacheGet.mockResolvedValueOnce({
      data: { x: 1 },
      degraded: true,
      staleAge: 120,
    });

    const fetcher = vi.fn().mockRejectedValue(new Error('RPC down'));

    const result = await withCache('key', 10, 300, fetcher);

    expect(result.data).toEqual({ x: 1 });
    expect(result.degraded).toBe(true);
    expect(result.staleAge).toBe(120);
  });

  it('throws when fetcher fails and no stale data', async () => {
    mockCacheGet.mockResolvedValueOnce(null);

    const fetcher = vi.fn().mockRejectedValue(new Error('RPC down'));

    await expect(withCache('key', 10, 300, fetcher)).rejects.toThrow('RPC down');
  });

  it('bypasses cache when Redis is unavailable', async () => {
    mockGetRedis.mockReturnValue(null);

    const fetcher = vi.fn().mockResolvedValue({ x: 99 });

    const result = await withCache('key', 10, 300, fetcher);

    expect(result.data).toEqual({ x: 99 });
    expect(result.degraded).toBe(false);
    expect(mockCacheGet).not.toHaveBeenCalled();
  });

  describe('known-down short-circuit (docs §2.3 step 3)', () => {
    it('serves stale data WITHOUT an upstream attempt when Steem is known down', async () => {
      mockCacheGet.mockResolvedValueOnce({
        data: { x: 1 },
        degraded: true,
        staleAge: 200,
      });
      mockIsSteemKnownDown.mockResolvedValue(true);

      const fetcher = vi.fn().mockResolvedValue({ x: 2 });

      const result = await withCache('key', 10, 300, fetcher);

      expect(fetcher).not.toHaveBeenCalled();
      expect(result.data).toEqual({ x: 1 });
      expect(result.degraded).toBe(true);
      expect(result.staleAge).toBe(200);
    });

    it('throws WITHOUT an upstream attempt when Steem is known down and no cache exists', async () => {
      mockCacheGet.mockResolvedValueOnce(null); // cache miss
      mockIsSteemKnownDown.mockResolvedValue(true);

      const fetcher = vi.fn().mockResolvedValue({ x: 2 });

      await expect(withCache('key', 10, 300, fetcher)).rejects.toThrow(
        /known down/i
      );
      // The whole point: a known-down node is never hammered by cache misses.
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('single-flight (concurrent miss deduplication)', () => {
    it('coalesces concurrent identical cache misses into ONE fetcher call', async () => {
      mockCacheGet.mockResolvedValue(null);

      // Resolve on a macrotask so all concurrent callers get a chance to
      // reach the single-flight registration before the flight settles.
      const fetcher = vi.fn(
        () =>
          new Promise<{ x: number }>((resolve) => {
            setTimeout(() => resolve({ x: 7 }), 0);
          })
      );

      const [a, b, c] = await Promise.all([
        withCache('shared-key', 10, 300, fetcher),
        withCache('shared-key', 10, 300, fetcher),
        withCache('shared-key', 10, 300, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(mockCacheSet).toHaveBeenCalledOnce();
      expect(a.data).toEqual({ x: 7 });
      expect(b.data).toEqual({ x: 7 });
      expect(c.data).toEqual({ x: 7 });
    });

    it('runs a fresh flight after the previous one settles (no cross-request stickiness)', async () => {
      mockCacheGet.mockResolvedValue(null);
      const fetcher = vi.fn().mockResolvedValue({ x: 1 });

      await withCache('seq-key', 10, 300, fetcher);
      await withCache('seq-key', 10, 300, fetcher);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('does not coalesce misses for different keys', async () => {
      mockCacheGet.mockResolvedValue(null);
      const fetcher = vi.fn().mockResolvedValue({ x: 1 });

      await Promise.all([
        withCache('key-a', 10, 300, fetcher),
        withCache('key-b', 10, 300, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('shares the failure among concurrent callers when the fetcher fails with no stale data', async () => {
      mockCacheGet.mockResolvedValue(null);
      const fetcher = vi.fn().mockRejectedValue(new Error('RPC down'));

      const results = await Promise.allSettled([
        withCache('fail-key', 10, 300, fetcher),
        withCache('fail-key', 10, 300, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
    });

    it('coalesces concurrent fetches even when Redis is unavailable', async () => {
      mockGetRedis.mockReturnValue(null);
      const fetcher = vi.fn().mockResolvedValue({ x: 5 });

      await Promise.all([
        withCache('no-redis-key', 10, 300, fetcher),
        withCache('no-redis-key', 10, 300, fetcher),
      ]);

      expect(fetcher).toHaveBeenCalledOnce();
    });
  });
});
