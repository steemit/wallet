import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockWithCache = vi.fn();
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: (...args: unknown[]) => mockWithCache(...args),
}));

const mockListVotes = vi.fn();
const mockGetGlobalProps = vi.fn();
const mockGetAccounts = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    listProposalVotesByProposal: (...args: unknown[]) => mockListVotes(...args),
    getGlobalProperties: (...args: unknown[]) => mockGetGlobalProps(...args),
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
  },
}));

import { GET } from '@/app/api/query/proposals/votes/route';

describe('GET /api/query/proposals/votes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(null);
    mockWithCache.mockImplementation(async (_key: string, _ttl: number, _swr: number, fn: () => Promise<unknown>) => {
      return { data: await fn(), degraded: false, staleAge: 0 };
    });
  });

  it('returns voters sorted by SP', async () => {
    mockListVotes.mockResolvedValue([
      { voter: 'alice', proposal: { proposal_id: 7 } },
      { voter: 'bob', proposal: { proposal_id: 7 } },
    ]);
    mockGetGlobalProps.mockResolvedValue({
      total_vesting_shares: '100.000000 VESTS',
      total_vesting_fund_steem: '1000000.000 STEEM',
    });
    mockGetAccounts.mockResolvedValue([
      { name: 'alice', vesting_shares: '60.000000 VESTS', proxied_vsf_votes: ['0'], proxy: '' },
      { name: 'bob', vesting_shares: '40.000000 VESTS', proxied_vsf_votes: ['0'], proxy: '' },
    ]);

    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=7' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.voters).toHaveLength(2);
    expect(body.voters[0].voter).toBe('alice');
    expect(body.voters[0].sp).toBeGreaterThan(body.voters[1].sp);
  });

  it('validates proposalId', async () => {
    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=bad' } as never);
    expect(res.status).toBe(400);
  });

  it('paginates and stops when proposal id changes', async () => {
    const page1 = Array.from({ length: 1000 }, () => ({ voter: 'alice', proposal: { proposal_id: 9 } }));
    const page2 = [{ voter: 'bob', proposal: { proposal_id: 999 } }]; // triggers early break
    mockListVotes.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    mockGetGlobalProps.mockResolvedValue({
      total_vesting_shares: '100.000000 VESTS',
      total_vesting_fund_steem: '1000000.000 STEEM',
    });
    mockGetAccounts.mockResolvedValue([{ name: 'alice', vesting_shares: '1.000000 VESTS', proxied_vsf_votes: ['0'], proxy: '' }]);

    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=9' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.voters[0].voter).toBe('alice');
  });

  it('returns 503 when cache wrapper throws', async () => {
    mockWithCache.mockRejectedValue(new Error('cache down'));
    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=1' } as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.degraded).toBe(true);
  });

  it('chunks getAccounts into batches of 100 (accounts-route cap) for >100 voters', async () => {
    // 150 distinct voters for proposal 9 — one more than one batch.
    const voters = Array.from({ length: 150 }, (_, i) => ({
      voter: `voter-${i}`,
      proposal: { proposal_id: 9 },
    }));
    mockListVotes.mockResolvedValueOnce(voters);
    mockGetGlobalProps.mockResolvedValue({
      total_vesting_shares: '100.000000 VESTS',
      total_vesting_fund_steem: '1000000.000 STEEM',
    });
    mockGetAccounts.mockImplementation(async (names: string[]) =>
      names.map((n) => ({
        name: n,
        vesting_shares: '1.000000 VESTS',
        proxied_vsf_votes: ['0'],
        proxy: '',
      }))
    );

    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=9' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Two upstream batches: 100 + 50 names, merged in order.
    expect(mockGetAccounts).toHaveBeenCalledTimes(2);
    const firstBatch = mockGetAccounts.mock.calls[0][0] as string[];
    const secondBatch = mockGetAccounts.mock.calls[1][0] as string[];
    expect(firstBatch).toHaveLength(100);
    expect(secondBatch).toHaveLength(50);
    expect(firstBatch[0]).toBe('voter-0');
    expect(secondBatch[0]).toBe('voter-100');
    expect(body.voters).toHaveLength(150);
  });

  it('follows the §3.6 degraded protocol: staleAge in body, X-Degraded + Cache-Control headers', async () => {
    mockWithCache.mockResolvedValueOnce({ data: { voters: [] }, degraded: true, staleAge: 33 });

    const res = await GET({ url: 'http://test/api/query/proposals/votes?proposalId=1' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.staleAge).toBe(33);
    expect(res.headers.get('X-Degraded')).toBe('true');
    // Voter rows are proposal-scoped global data — shared caching is fine.
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=20, stale-while-revalidate=60');
  });
});

