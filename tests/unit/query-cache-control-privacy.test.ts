/**
 * Cache-Control privacy tests for user-scoped query routes (finding E-3).
 *
 * Responses whose body contains user-specific rows (open orders, savings
 * memos, per-account delegations, withdraw routing) must be `private` — a
 * shared/CDN cache storing a `public` response lets one user's rows be served
 * to another (cross-user cache poisoning). Global/anonymous data stays
 * `public` with its TTL so the CDN can still absorb anonymous traffic.
 * proposals/route.ts established the pattern; these routes now follow it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedis } from '@/lib/cache/redis';
import { isSteemKnownDown } from '@/lib/cache/health-monitor';

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

// Passthrough withCache that can be flipped to a degraded result per test.
let withCacheResult: { degraded: boolean; staleAge?: number } = { degraded: false };
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: vi.fn(
    async (
      _key: string,
      _ttl: number,
      _staleTtl: number,
      fetcher: () => Promise<unknown>
    ) => ({ data: await fetcher(), ...withCacheResult })
  ),
}));

vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getMarketOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
    getMarketTicker: vi.fn().mockResolvedValue({ high: '1' }),
    getMarketRecentTrades: vi.fn().mockResolvedValue([]),
    getMarketTradeHistorySince: vi.fn().mockResolvedValue([]),
    getMarketOpenOrders: vi.fn().mockResolvedValue([{ id: 1 }]),
    getWalletEstimateExtras: vi.fn().mockResolvedValue({ savings: [] }),
    getWithdrawRoutesOutgoing: vi.fn().mockResolvedValue([]),
    getVestingDelegations: vi.fn().mockResolvedValue([]),
    getExpiringVestingDelegations: vi.fn().mockResolvedValue([]),
    listProposals: vi.fn().mockResolvedValue([]),
    listProposalVotesByVoter: vi.fn().mockResolvedValue([]),
    listProposalVotesByProposal: vi.fn().mockResolvedValue([]),
    getGlobalProperties: vi.fn().mockResolvedValue({
      total_vesting_shares: '1 VESTS',
      total_vesting_fund_steem: '1 STEEM',
    }),
    getAccounts: vi.fn().mockResolvedValue([]),
    getAccountHistory: vi.fn().mockResolvedValue([]),
  },
}));

interface CacheControlCase {
  name: string;
  url: string;
  importRoute: () => Promise<{ GET: (req: NextRequest) => Promise<Response> }>;
  expected: string;
}

const USER_SCOPED_CASES: CacheControlCase[] = [
  {
    name: 'market with username (openOrders in body) → private',
    url: '/api/query/market?username=alice',
    importRoute: () => import('@/app/api/query/market/route'),
    expected: 'private, max-age=5',
  },
  {
    name: 'wallet-estimate-extras (savings memos in body) → private',
    url: '/api/query/wallet-estimate-extras?username=alice',
    importRoute: () => import('@/app/api/query/wallet-estimate-extras/route'),
    expected: 'private, max-age=60',
  },
  {
    name: 'withdraw-routes (per-user routing) → private',
    url: '/api/query/withdraw-routes?username=alice',
    importRoute: () => import('@/app/api/query/withdraw-routes/route'),
    expected: 'private, max-age=60',
  },
  {
    name: 'vesting-delegations (per-account rows) → private',
    url: '/api/query/vesting-delegations?account=alice',
    importRoute: () => import('@/app/api/query/vesting-delegations/route'),
    expected: 'private, max-age=15',
  },
  {
    name: 'expiring-vesting-delegations (per-account rows) → private',
    url: '/api/query/expiring-vesting-delegations?account=alice',
    importRoute: () => import('@/app/api/query/expiring-vesting-delegations/route'),
    expected: 'private, max-age=15',
  },
  {
    name: 'proposals with username (upVoted flags in body) → private',
    url: '/api/query/proposals?username=alice',
    importRoute: () => import('@/app/api/query/proposals/route'),
    expected: 'private, max-age=15',
  },
  {
    name: 'history legacy path (raw account rows incl. memos) → private, no-store',
    url: '/api/query/history?username=alice',
    importRoute: () => import('@/app/api/query/history/route'),
    expected: 'private, no-store',
  },
  {
    name: 'history filtered path (per-account rows) → private, no-store',
    url: '/api/query/history?username=alice&ops=transfer',
    importRoute: () => import('@/app/api/query/history/route'),
    expected: 'private, no-store',
  },
];

const GLOBAL_CASES: CacheControlCase[] = [
  {
    name: 'market anonymous (global orderbook only) → public',
    url: '/api/query/market',
    importRoute: () => import('@/app/api/query/market/route'),
    expected: 'public, s-maxage=5, stale-while-revalidate=30',
  },
  {
    name: 'proposals anonymous → public',
    url: '/api/query/proposals',
    importRoute: () => import('@/app/api/query/proposals/route'),
    expected: 'public, s-maxage=15, stale-while-revalidate=120',
  },
];

describe('GET /api/query/* — Cache-Control privacy for user-scoped bodies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withCacheResult = { degraded: false };
  });

  it.each(USER_SCOPED_CASES.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, testCase) => {
      const route = await testCase.importRoute();
      const res = await route.GET(new NextRequest(`http://localhost${testCase.url}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe(testCase.expected);
      // Private responses must never announce shared-cache directives.
      expect(res.headers.get('Cache-Control')).not.toContain('public');
    }
  );

  it.each(GLOBAL_CASES.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, testCase) => {
      const route = await testCase.importRoute();
      const res = await route.GET(new NextRequest(`http://localhost${testCase.url}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe(testCase.expected);
    }
  );

  it('market degraded responses keep the private header AND add X-Degraded', async () => {
    withCacheResult = { degraded: true, staleAge: 42 };
    const route = await import('@/app/api/query/market/route');
    const res = await route.GET(
      new NextRequest('http://localhost/api/query/market?username=alice')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=5');
    expect(res.headers.get('X-Degraded')).toBe('true');
    const body = (await res.json()) as { degraded?: boolean; staleAge?: number };
    expect(body.degraded).toBe(true);
    expect(body.staleAge).toBe(42);
  });

  it('history degraded fallback keeps the private header AND adds X-Degraded', async () => {
    // Known-down node + a Redis fallback copy → degraded 200 from §3.5.
    vi.mocked(isSteemKnownDown).mockResolvedValueOnce(true);
    vi.mocked(getRedis).mockReturnValueOnce({
      get: vi.fn().mockResolvedValue(JSON.stringify([{ index: 1, op: ['transfer', {}] }])),
    } as unknown as ReturnType<typeof getRedis>);
    const route = await import('@/app/api/query/history/route');
    const res = await route.GET(
      new NextRequest('http://localhost/api/query/history?username=alice')
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Degraded')).toBe('true');
    const body = (await res.json()) as { degraded?: boolean; history?: unknown[] };
    expect(body.degraded).toBe(true);
    expect(body.history).toEqual([{ index: 1, op: ['transfer', {}] }]);
  });
});
