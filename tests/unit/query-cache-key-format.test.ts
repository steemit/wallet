/**
 * Query cache-key construction tests (finding A-4).
 *
 * Every query route builds its Redis key through hashedCacheKey (full SHA-256
 * digest per component) — one style, no variants. Before unification,
 * accounts used a 32-hex TRUNCATED digest and witnesses / proposals/votes
 * interpolated trusted integers in plaintext. Old-format entries simply
 * expire by TTL; nothing reads them.
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
    getAccounts: vi.fn().mockResolvedValue([]),
    getWitnessesByVote: vi.fn().mockResolvedValue([]),
    listProposalVotesByProposal: vi.fn().mockResolvedValue([]),
    getGlobalProperties: vi.fn().mockResolvedValue({
      total_vesting_shares: '1 VESTS',
      total_vesting_fund_steem: '1 STEEM',
    }),
  },
}));

function makeRequest(path: string, params: Record<string, string>) {
  const url = new URL(`http://localhost${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  vi.clearAllMocks();
  withCacheKeys.length = 0;
});

describe('query cache-key construction — one helper, full digests', () => {
  it('accounts: full 64-hex digest of the normalized list (not truncated, not plaintext)', async () => {
    const { GET } = await import('@/app/api/query/accounts/route');
    const res = await GET(makeRequest('/api/query/accounts', { names: 'alice,bob' }));
    expect(res.status).toBe(200);
    expect(withCacheKeys).toHaveLength(1);
    expect(withCacheKeys[0]).toMatch(/^cache:query:accounts:[0-9a-f]{64}$/);
    expect(withCacheKeys[0]).not.toContain('alice');
  });

  it('witnesses: full 64-hex digest of limit (no plaintext integer)', async () => {
    const { GET } = await import('@/app/api/query/witnesses/route');
    const res = await GET(makeRequest('/api/query/witnesses', { limit: '100' }));
    expect(res.status).toBe(200);
    expect(withCacheKeys[0]).toMatch(/^cache:query:witnesses:[0-9a-f]{64}$/);
    // The trusted integer is hashed like everything else — no plaintext leak.
    expect(withCacheKeys[0]).not.toMatch(/:100$/);
  });

  it('witnesses: same limit -> same key, different limit -> different key', async () => {
    const { GET } = await import('@/app/api/query/witnesses/route');
    await GET(makeRequest('/api/query/witnesses', { limit: '100' }));
    await GET(makeRequest('/api/query/witnesses', { limit: '100' }));
    await GET(makeRequest('/api/query/witnesses', { limit: '200' }));
    expect(withCacheKeys[0]).toBe(withCacheKeys[1]);
    expect(withCacheKeys[0]).not.toBe(withCacheKeys[2]);
  });

  it('proposals/votes: full 64-hex digest of proposalId', async () => {
    const { GET } = await import('@/app/api/query/proposals/votes/route');
    const res = await GET(makeRequest('/api/query/proposals/votes', { proposalId: '7' }));
    expect(res.status).toBe(200);
    expect(withCacheKeys[0]).toMatch(/^cache:query:proposals:votes:[0-9a-f]{64}$/);
    expect(withCacheKeys[0]).not.toMatch(/:7$/);
  });

  it('broadcast invalidation prefixes still cover the hashed key formats', async () => {
    // cacheDeleteByPrefix appends `*` — the trusted route prefix must remain
    // the leading component so broadcast-side deletes keep matching.
    const { GET } = await import('@/app/api/query/witnesses/route');
    await GET(makeRequest('/api/query/witnesses', { limit: '100' }));
    expect(withCacheKeys[0]!.startsWith('cache:query:witnesses:')).toBe(true);
  });
});
