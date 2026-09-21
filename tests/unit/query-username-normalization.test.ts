/**
 * Query-route username normalization parity tests (review findings C-1/C-2).
 *
 * Steem names are canonical lowercase on chain; clients may send "Alice",
 * "@Alice" or "alice" for the same account. Every query route that accepts a
 * username parameter must normalize it (same helper as PR #339's
 * `normalizeAccountForCache` pattern) BEFORE cache-key construction and
 * upstream calls — otherwise one account fragments into several cache keys
 * and per-user response flags (e.g. market open orders) diverge by spelling.
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
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getAccountHistory: vi.fn().mockResolvedValue([]),
    getOwnerHistory: vi.fn().mockResolvedValue([]),
    getAccounts: vi.fn().mockResolvedValue([]),
    getMarketOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
    getMarketTicker: vi.fn().mockResolvedValue({}),
    getMarketRecentTrades: vi.fn().mockResolvedValue([]),
    getMarketOpenOrders: vi.fn().mockResolvedValue([]),
    listProposals: vi.fn().mockResolvedValue([]),
    listProposalVotesByVoter: vi.fn().mockResolvedValue([]),
  },
}));

// Capture the cache key each withCache caller builds; the fetcher still runs.
const withCacheKeys: string[] = [];
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: vi.fn(
    async (key: string, _ttl: number, _staleTtl: number, fetcher: () => Promise<unknown>) => {
      withCacheKeys.push(key);
      return { data: await fetcher(), degraded: false };
    }
  ),
}));

import { SteemService } from '@/lib/steem/server';

function makeRequest(path: string, params: Record<string, string>) {
  const url = new URL(`http://localhost${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  vi.clearAllMocks();
  withCacheKeys.length = 0;
});

describe('GET /api/query/history — username parity', () => {
  it.each([
    ['filtered path', { ops: 'transfer' } as Record<string, string>],
    ['legacy path', {} as Record<string, string>],
  ])('normalizes the account on the %s (Alice and alice hit the same upstream account)', async (_name, extra) => {
    const { GET } = await import('@/app/api/query/history/route');
    for (const username of ['Alice', '@Alice', 'alice', '  alice  ']) {
      vi.mocked(SteemService.getAccountHistory).mockClear();
      const res = await GET(makeRequest('/api/query/history', { username, ...extra }));
      expect(res.status).toBe(200);
      expect(SteemService.getAccountHistory).toHaveBeenCalledTimes(1);
      const call = vi.mocked(SteemService.getAccountHistory).mock.calls[0] as [string];
      expect(call[0]).toBe('alice');
    }
  });
});

describe('GET /api/query/market — username parity', () => {
  it('builds the SAME cache key and calls open orders with the canonical name', async () => {
    const { GET } = await import('@/app/api/query/market/route');

    const resA = await GET(makeRequest('/api/query/market', { username: 'Alice' }));
    const resB = await GET(makeRequest('/api/query/market', { username: '@alice ' }));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(withCacheKeys).toHaveLength(2);
    expect(withCacheKeys[0]).toBe(withCacheKeys[1]);
    const openOrdersCalls = vi.mocked(SteemService.getMarketOpenOrders).mock.calls as [string][];
    expect(openOrdersCalls.map((c) => c[0])).toEqual(['alice', 'alice']);
  });

  it('keeps the no-username key distinct from a username key', async () => {
    const { GET } = await import('@/app/api/query/market/route');
    await GET(makeRequest('/api/query/market', {}));
    await GET(makeRequest('/api/query/market', { username: 'alice' }));
    expect(withCacheKeys[0]).not.toBe(withCacheKeys[1]);
  });
});

describe('GET /api/query/owner-history — username parity', () => {
  it('normalizes the account before the upstream call', async () => {
    const { GET } = await import('@/app/api/query/owner-history/route');
    for (const username of ['Alice', '@Alice', 'alice']) {
      vi.mocked(SteemService.getOwnerHistory).mockClear();
      const res = await GET(makeRequest('/api/query/owner-history', { username }));
      expect(res.status).toBe(200);
      expect(SteemService.getOwnerHistory).toHaveBeenCalledWith('alice');
    }
  });
});

describe('GET /api/query/accounts — names parity', () => {
  it('normalizes every name: same upstream list and SAME cache key for differently-cased lists', async () => {
    const { GET } = await import('@/app/api/query/accounts/route');

    const resA = await GET(makeRequest('/api/query/accounts', { names: 'Alice,Bob' }));
    const resB = await GET(makeRequest('/api/query/accounts', { names: '@alice,bob ' }));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(SteemService.getAccounts).toHaveBeenNthCalledWith(1, ['alice', 'bob']);
    expect(SteemService.getAccounts).toHaveBeenNthCalledWith(2, ['alice', 'bob']);
    expect(withCacheKeys).toHaveLength(2);
    expect(withCacheKeys[0]).toBe(withCacheKeys[1]);
  });

  it('still rejects an all-empty names list', async () => {
    const { GET } = await import('@/app/api/query/accounts/route');
    const res = await GET(makeRequest('/api/query/accounts', { names: ' , ' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/query/proposals — username parity', () => {
  it('builds the SAME cache key and queries votes with the canonical name', async () => {
    const { GET } = await import('@/app/api/query/proposals/route');

    const resA = await GET(makeRequest('/api/query/proposals', { username: 'Alice' }));
    const resB = await GET(makeRequest('/api/query/proposals', { username: '@alice ' }));
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(withCacheKeys).toHaveLength(2);
    expect(withCacheKeys[0]).toBe(withCacheKeys[1]);
    const voteCalls = vi.mocked(SteemService.listProposalVotesByVoter).mock.calls as [string][];
    expect(voteCalls.map((c) => c[0])).toEqual(['alice', 'alice']);
  });

  it('keeps the anonymous key distinct from a username key', async () => {
    const { GET } = await import('@/app/api/query/proposals/route');
    await GET(makeRequest('/api/query/proposals', {}));
    await GET(makeRequest('/api/query/proposals', { username: 'alice' }));
    expect(withCacheKeys[0]).not.toBe(withCacheKeys[1]);
  });
});
