import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockGetOwnerHistory = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    getOwnerHistory: (...args: unknown[]) => mockGetOwnerHistory(...args),
  },
}));

import { GET } from '@/app/api/query/owner-history/route';

describe('GET /api/query/owner-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(null);
  });

  it('returns 400 when username missing', async () => {
    const res = await GET({ url: 'http://test/api/query/owner-history' } as never);
    expect(res.status).toBe(400);
  });

  it('returns history on success', async () => {
    mockGetOwnerHistory.mockResolvedValue([{ foo: 'bar' }]);
    const res = await GET({ url: 'http://test/api/query/owner-history?username=  ALICE  ' } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.history)).toBe(true);
    expect(mockGetOwnerHistory).toHaveBeenCalledWith('alice');
  });

  it('returns 503 on service error', async () => {
    mockGetOwnerHistory.mockRejectedValue(new Error('boom'));
    const res = await GET({ url: 'http://test/api/query/owner-history?username=alice' } as never);
    expect(res.status).toBe(503);
  });

  it('short-circuits when rate limited', async () => {
    mockRateLimit.mockResolvedValue(new Response('rl', { status: 429 }));
    const res = await GET({ url: 'http://test/api/query/owner-history?username=alice' } as never);
    expect(res.status).toBe(429);
    expect(mockGetOwnerHistory).not.toHaveBeenCalled();
  });
});

