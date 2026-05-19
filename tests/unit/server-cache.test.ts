import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis module at the boundary
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDeleteByPrefix = vi.fn();
const mockGetRedis = vi.fn();

vi.mock('@/lib/cache/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDeleteByPrefix: (...args: unknown[]) => mockCacheDeleteByPrefix(...args),
  getRedis: () => mockGetRedis(),
}));

import { withCache } from '@/lib/cache/server-cache';

describe('withCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Redis is available
    mockGetRedis.mockReturnValue({});
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
});
