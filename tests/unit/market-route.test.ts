/**
 * Market route `since` handling tests (finding E-7).
 *
 * The client polls every few seconds with a fresh ISO `since` cursor. Keying
 * the cache on the raw value gave every poll a unique key (cache never
 * engages for logged-in traffic) and let one user rotate arbitrary `since`
 * strings into an unbounded Redis keyspace. The route must (1) reject garbage
 * `since` with 400 and (2) quantize the cursor to a 30-second bucket for
 * CACHE-KEY purposes while the upstream call still uses the precise value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/cache/redis', () => ({
  getRedis: vi.fn().mockReturnValue(null),
  redisKey: (k: string) => `wallet:${k}`,
}));
vi.mock('@/lib/cache/health-monitor', () => ({
  isSteemKnownDown: vi.fn().mockResolvedValue(false),
}));

const withCacheKeys: string[] = [];
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: vi.fn(
    async (
      key: string,
      _ttl: number,
      _staleTtl: number,
      fetcher: () => Promise<unknown>
    ) => {
      withCacheKeys.push(key);
      return { data: await fetcher(), degraded: false };
    }
  ),
}));

vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getMarketOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
    getMarketTicker: vi.fn().mockResolvedValue({}),
    getMarketRecentTrades: vi.fn().mockResolvedValue([]),
    getMarketTradeHistorySince: vi.fn().mockResolvedValue([]),
    getMarketOpenOrders: vi.fn().mockResolvedValue([]),
  },
}));

import { SteemService } from '@/lib/steem/server';

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/query/market');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  vi.clearAllMocks();
  withCacheKeys.length = 0;
});

describe('GET /api/query/market — since validation', () => {
  it.each([
    ['plain word', 'garbage'],
    ['sql-ish injection attempt', "2026-01-01' OR '1'='1"],
    ['date only (no time)', '2026-09-22'],
    ['overflowing month', '2026-13-45T99:99:99'],
    ['relative epoch garbage', '-1'],
  ])('rejects a malformed since (%s) with 400', async (_name, since) => {
    const { GET } = await import('@/app/api/query/market/route');
    const res = await GET(makeRequest({ since }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid since parameter');
    // Nothing reached the cache layer or the upstream for garbage input.
    expect(withCacheKeys).toHaveLength(0);
    expect(SteemService.getMarketTradeHistorySince).not.toHaveBeenCalled();
  });

  it.each([
    ['plain seconds form', '2026-09-22T10:00:00'],
    ['with Z suffix', '2026-09-22T10:00:00Z'],
    ['with milliseconds', '2026-09-22T10:00:00.123'],
    ['with milliseconds and Z', '2026-09-22T10:00:00.123Z'],
  ])('accepts the ISO-8601 forms the client sends (%s)', async (_name, since) => {
    const { GET } = await import('@/app/api/query/market/route');
    const res = await GET(makeRequest({ since }));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/query/market — since bucketed cache key', () => {
  it('uses the SAME cache key for since values inside one 30s bucket', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    // All three denote instants inside the same 30s window (naive local
    // forms, as the client sends them; note Z-suffixed values are different
    // instants on a non-UTC host, so they are not mixed in here).
    await GET(makeRequest({ since: '2026-09-22T10:00:00' }));
    await GET(makeRequest({ since: '2026-09-22T10:00:20' }));
    await GET(makeRequest({ since: '2026-09-22T10:00:29.999' }));

    expect(withCacheKeys).toHaveLength(3);
    expect(new Set(withCacheKeys).size).toBe(1);
  });

  it('uses DIFFERENT cache keys across 30s bucket boundaries', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    await GET(makeRequest({ since: '2026-09-22T10:00:29' }));
    await GET(makeRequest({ since: '2026-09-22T10:00:30' }));
    await GET(makeRequest({ since: '2026-09-22T10:01:00' }));

    expect(withCacheKeys).toHaveLength(3);
    expect(new Set(withCacheKeys).size).toBe(3);
  });

  it('separates buckets per username (no cross-user cache entries)', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    await GET(makeRequest({ username: 'alice', since: '2026-09-22T10:00:00' }));
    await GET(makeRequest({ username: 'bob', since: '2026-09-22T10:00:00' }));

    expect(withCacheKeys).toHaveLength(2);
    expect(withCacheKeys[0]).not.toBe(withCacheKeys[1]);
  });

  it('keeps the anonymous no-since key distinct and reusable', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    await GET(makeRequest({}));
    await GET(makeRequest({}));
    await GET(makeRequest({ since: '2026-09-22T10:00:00' }));

    expect(withCacheKeys).toHaveLength(3);
    expect(withCacheKeys[0]).toBe(withCacheKeys[1]);
    expect(withCacheKeys[0]).not.toBe(withCacheKeys[2]);
  });

  it('forwards the PRECISE since to the upstream, not the bucket', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    await GET(makeRequest({ since: '2026-09-22T10:00:20.5' }));

    expect(SteemService.getMarketTradeHistorySince).toHaveBeenCalledWith('2026-09-22T10:00:20.5');
    // Bucketed key: the raw timestamp must never appear in the key itself.
    expect(withCacheKeys[0]).not.toContain('2026');
  });
});
