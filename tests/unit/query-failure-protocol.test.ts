/**
 * Unified upstream-failure protocol tests for /api/query/* routes (finding E-2).
 *
 * ONE contract for every query route (docs/CACHING_AND_DEGRADATION.md §3.6):
 * when the upstream Steem RPC fails and no stale fallback is available, the
 * route returns HTTP 503 with `{ error, degraded: true }`. Before this was
 * unified the routes split into 500 (history/market/vesting-delegations/
 * expiring-…), 503+degraded (accounts/global-props/wallet-prices family), and
 * double-layer catches whose inner 503 was shadowed by an outer 500
 * (witnesses/median-history-price/wallet-estimate-extras/withdraw-routes).
 *
 * The withCache mock runs the real fetcher, so a rejecting SteemService call
 * propagates exactly like a real upstream failure would. Redis and the health
 * monitor are mocked away so no stale fallback can rescue the response.
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

// Run the fetcher directly — a rejecting SteemService call rejects withCache,
// which is what a real upstream failure with no stale data does.
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: vi.fn(
    async (
      _key: string,
      _ttl: number,
      _staleTtl: number,
      fetcher: () => Promise<unknown>
    ) => ({ data: await fetcher(), degraded: false })
  ),
}));

vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getAccounts: vi.fn().mockResolvedValue([]),
    getGlobalProperties: vi.fn().mockResolvedValue({}),
    getWalletPrices: vi.fn().mockResolvedValue({}),
    getCurrentMedianHistoryPrice: vi.fn().mockResolvedValue({}),
    getWitnessesByVote: vi.fn().mockResolvedValue([]),
    getMarketOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
    getMarketTicker: vi.fn().mockResolvedValue({}),
    getMarketRecentTrades: vi.fn().mockResolvedValue([]),
    getMarketTradeHistorySince: vi.fn().mockResolvedValue([]),
    getMarketOpenOrders: vi.fn().mockResolvedValue([]),
    getWalletEstimateExtras: vi.fn().mockResolvedValue({}),
    getWithdrawRoutesOutgoing: vi.fn().mockResolvedValue([]),
    getVestingDelegations: vi.fn().mockResolvedValue([]),
    getExpiringVestingDelegations: vi.fn().mockResolvedValue([]),
    getAccountHistory: vi.fn().mockResolvedValue([]),
    getOwnerHistory: vi.fn().mockResolvedValue([]),
    listProposals: vi.fn().mockResolvedValue([]),
    listProposalVotesByVoter: vi.fn().mockResolvedValue([]),
    listProposalVotesByProposal: vi.fn().mockResolvedValue([]),
    prepareTransactionHeader: vi.fn().mockResolvedValue({}),
  },
}));

import { SteemService } from '@/lib/steem/server';

interface FailureCase {
  name: string;
  url: string;
  /** SteemService method whose rejection simulates the upstream failure. */
  method: keyof typeof SteemService;
  expectedError: string;
}

const FAILURE_CASES: FailureCase[] = [
  {
    name: 'accounts',
    url: '/api/query/accounts?names=alice',
    method: 'getAccounts',
    expectedError: 'Failed to fetch accounts',
  },
  {
    name: 'global-props',
    url: '/api/query/global-props',
    method: 'getGlobalProperties',
    expectedError: 'Failed to fetch global properties',
  },
  {
    name: 'wallet-prices',
    url: '/api/query/wallet-prices',
    method: 'getWalletPrices',
    expectedError: 'Failed to fetch wallet prices',
  },
  {
    name: 'median-history-price',
    url: '/api/query/median-history-price',
    method: 'getCurrentMedianHistoryPrice',
    expectedError: 'Failed to fetch median history price',
  },
  {
    name: 'witnesses',
    url: '/api/query/witnesses?limit=100',
    method: 'getWitnessesByVote',
    expectedError: 'Failed to fetch witnesses',
  },
  {
    name: 'market',
    url: '/api/query/market',
    method: 'getMarketOrderBook',
    expectedError: 'Failed to fetch market data',
  },
  {
    name: 'wallet-estimate-extras',
    url: '/api/query/wallet-estimate-extras?username=alice',
    method: 'getWalletEstimateExtras',
    expectedError: 'Failed to fetch wallet estimate extras',
  },
  {
    name: 'withdraw-routes',
    url: '/api/query/withdraw-routes?username=alice',
    method: 'getWithdrawRoutesOutgoing',
    expectedError: 'Failed to fetch withdraw routes',
  },
  {
    name: 'vesting-delegations',
    url: '/api/query/vesting-delegations?account=alice',
    method: 'getVestingDelegations',
    expectedError: 'Failed to fetch vesting delegations',
  },
  {
    name: 'expiring-vesting-delegations',
    url: '/api/query/expiring-vesting-delegations?account=alice',
    method: 'getExpiringVestingDelegations',
    expectedError: 'Failed to fetch expiring vesting delegations',
  },
  {
    name: 'proposals',
    url: '/api/query/proposals',
    method: 'listProposals',
    expectedError: 'Failed to fetch proposals',
  },
  {
    name: 'proposals/votes',
    url: '/api/query/proposals/votes?proposalId=7',
    method: 'listProposalVotesByProposal',
    expectedError: 'Failed to fetch proposal voters',
  },
  {
    name: 'owner-history',
    url: '/api/query/owner-history?username=alice',
    method: 'getOwnerHistory',
    expectedError: 'Failed to fetch owner history',
  },
  {
    name: 'history (legacy path)',
    url: '/api/query/history?username=alice',
    method: 'getAccountHistory',
    expectedError: 'Failed to fetch history',
  },
  {
    name: 'history (filtered path)',
    url: '/api/query/history?username=alice&ops=transfer',
    method: 'getAccountHistory',
    expectedError: 'Failed to fetch history',
  },
  {
    name: 'transaction-header',
    url: '/api/query/transaction-header',
    method: 'prepareTransactionHeader',
    expectedError: 'Failed to fetch transaction header',
  },
];

const ROUTE_MODULES: Record<string, () => Promise<{ GET: (req: NextRequest) => Promise<Response> }>> = {
  accounts: () => import('@/app/api/query/accounts/route'),
  'global-props': () => import('@/app/api/query/global-props/route'),
  'wallet-prices': () => import('@/app/api/query/wallet-prices/route'),
  'median-history-price': () => import('@/app/api/query/median-history-price/route'),
  witnesses: () => import('@/app/api/query/witnesses/route'),
  market: () => import('@/app/api/query/market/route'),
  'wallet-estimate-extras': () => import('@/app/api/query/wallet-estimate-extras/route'),
  'withdraw-routes': () => import('@/app/api/query/withdraw-routes/route'),
  'vesting-delegations': () => import('@/app/api/query/vesting-delegations/route'),
  'expiring-vesting-delegations': () => import('@/app/api/query/expiring-vesting-delegations/route'),
  proposals: () => import('@/app/api/query/proposals/route'),
  'proposals/votes': () => import('@/app/api/query/proposals/votes/route'),
  'owner-history': () => import('@/app/api/query/owner-history/route'),
  history: () => import('@/app/api/query/history/route'),
  'transaction-header': () => import('@/app/api/query/transaction-header/route'),
};

function routeKey(name: string): string {
  // "history (legacy path)" / "history (filtered path)" share one module.
  return name.replace(/\s*\(.*\)$/, '');
}

async function loadRoute(name: string) {
  const loader = ROUTE_MODULES[routeKey(name)];
  if (!loader) throw new Error(`No route module registered for: ${name}`);
  return loader();
}

describe('GET /api/query/* — unified upstream-failure protocol (§3.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(FAILURE_CASES.map((c) => [c.name, c] as const))(
    '%s: upstream failure with no stale data → 503 + { error, degraded: true }',
    async (_name, testCase) => {
      const route = await loadRoute(testCase.name);
      const serviceFn = SteemService[testCase.method] as () => Promise<unknown>;
      vi.mocked(serviceFn).mockRejectedValueOnce(new Error('RPC down'));

      const res = await route.GET(new NextRequest(`http://localhost${testCase.url}`));

      expect(res.status).toBe(503);
      const body = (await res.json()) as { error?: string; degraded?: boolean };
      expect(body.error).toBe(testCase.expectedError);
      expect(body.degraded).toBe(true);
    }
  );

  it('validation errors stay plain 400 responses without a degraded flag', async () => {
    const route = await loadRoute('accounts');
    const res = await route.GET(new NextRequest('http://localhost/api/query/accounts'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; degraded?: boolean };
    expect(body.error).toBe('Missing names parameter');
    expect(body.degraded).toBeUndefined();
  });
});
