import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/query/owner-history/route';
import { NextRequest } from 'next/server';
import type { OwnerHistoryEntry } from '@/lib/steem/types';

// Mock rate limit middleware
vi.mock('@/lib/middleware', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock SteemService
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getOwnerHistory: vi.fn(),
  },
}));

// withCache passthrough by default (no Redis in tests); individual tests can
// flip it to a degraded result to pin the §3.6 response protocol.
const mockWithCache = vi.fn();
vi.mock('@/lib/cache/server-cache', () => ({
  withCache: (...args: unknown[]) => mockWithCache(...args),
}));

describe('GET /api/query/owner-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithCache.mockImplementation(
      async (
        _key: string,
        _ttl: number,
        _staleTtl: number,
        fetcher: () => Promise<unknown>
      ) => ({ data: await fetcher(), degraded: false })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(username: string): NextRequest {
    return new NextRequest(`http://localhost/api/query/owner-history?username=${encodeURIComponent(username)}`);
  }

  it('returns owner history for valid username', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    const mockHistory: OwnerHistoryEntry[] = [
      { previous_owner_authority: { key_auths: [['STMxxx', 1] as [string, number]] } },
    ];
    vi.mocked(SteemService.getOwnerHistory).mockResolvedValueOnce(mockHistory);

    const req = makeRequest('alice');
    const res = await GET(req);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.history).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  it('returns 400 when username is missing', async () => {
    const req = new NextRequest('http://localhost/api/query/owner-history');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('username required');
  });

  it('returns 400 when username is only whitespace', async () => {
    const req = makeRequest('   ');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('username required');
  });

  it('trims and lowercases username', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockResolvedValueOnce([]);

    const req = makeRequest('  Alice  ');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(SteemService.getOwnerHistory).toHaveBeenCalledWith('alice');
  });

  it('returns 503 with degraded flag when SteemService throws', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockRejectedValueOnce(
      new Error('RPC timeout')
    );

    const req = makeRequest('alice');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('Failed to fetch owner history');
    expect(data.degraded).toBe(true);
  });

  it('returns empty array when no history', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockResolvedValueOnce([]);

    const req = makeRequest('alice');
    const res = await GET(req);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.history).toEqual([]);
  });

  it('caches via withCache with a hashed, normalized user key', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockResolvedValueOnce([]);

    await GET(makeRequest('Alice'));
    expect(mockWithCache).toHaveBeenCalledTimes(1);
    const [key, ttl, staleTtl] = mockWithCache.mock.calls[0] as [string, number, number];
    expect(key).toMatch(/^cache:query:owner-history:[0-9a-f]{64}$/);
    expect(ttl).toBe(15);
    expect(staleTtl).toBe(300);
  });

  it('marks the response private — per-account rows must not hit shared caches', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockResolvedValueOnce([]);

    const res = await GET(makeRequest('alice'));
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
  });

  it('serves stale data with degraded + staleAge and X-Degraded when upstream fails', async () => {
    mockWithCache.mockResolvedValueOnce({
      data: [],
      degraded: true,
      staleAge: 77,
    });

    const res = await GET(makeRequest('alice'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.staleAge).toBe(77);
    expect(res.headers.get('X-Degraded')).toBe('true');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=15');
  });
});
