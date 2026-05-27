import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockWithCache = vi.fn();
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: (...args: unknown[]) => mockWithCache(...args),
}));

const mockGetAccounts = vi.fn();
const mockListProposals = vi.fn();
const mockGetChainConfig = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
    listProposals: (...args: unknown[]) => mockListProposals(...args),
    getChainConfig: (...args: unknown[]) => mockGetChainConfig(...args),
  },
}));

import { GET } from '@/app/api/query/proposals/dao-stats/route';

describe('GET /api/query/proposals/dao-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(null);
    mockWithCache.mockImplementation(async (_key: string, _ttl: number, _swr: number, fn: () => Promise<unknown>) => {
      return { data: await fn(), degraded: false, staleAge: 0 };
    });
  });

  it('returns treasury, daily budget, paid ids, and fee', async () => {
    mockGetAccounts.mockResolvedValue([{ sbd_balance: '100.000 SBD' }]);
    mockListProposals.mockResolvedValue([
      { proposal_id: 1, daily_pay: '1.000 SBD' },
      { proposal_id: 2, daily_pay: '200.000 SBD' },
    ]);
    mockGetChainConfig.mockResolvedValue({ STEEM_TREASURY_FEE: 2000 });

    const res = await GET({ url: 'http://test/api/query/proposals/dao-stats' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.daoTreasury).toBe('100.000');
    expect(body.dailyBudget).toBe('1.000');
    expect(body.paidProposalIds).toEqual([1]);
    expect(body.treasuryFeeSbd).toBe('2.000');
  });

  it('sets fee to null when config fetch fails', async () => {
    mockGetAccounts.mockResolvedValue([{ sbd_balance: '100.000 SBD' }]);
    mockListProposals.mockResolvedValue([]);
    mockGetChainConfig.mockRejectedValue(new Error('nope'));

    const res = await GET({ url: 'http://test/api/query/proposals/dao-stats' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.treasuryFeeSbd).toBe(null);
  });

  it('returns 503 on unexpected error', async () => {
    mockGetAccounts.mockRejectedValue(new Error('boom'));
    const res = await GET({ url: 'http://test/api/query/proposals/dao-stats' } as never);
    expect(res.status).toBe(503);
  });
});

