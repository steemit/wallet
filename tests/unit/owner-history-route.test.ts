import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/query/owner-history/route';
import { NextRequest } from 'next/server';

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

describe('GET /api/query/owner-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(username: string): NextRequest {
    return new NextRequest(`http://localhost/api/query/owner-history?username=${encodeURIComponent(username)}`);
  }

  it('returns owner history for valid username', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    const mockHistory = [
      { previous_owner_authority: { key_auths: [['STMxxx', 1]] } },
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

  it('returns 503 when SteemService throws', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.getOwnerHistory).mockRejectedValueOnce(
      new Error('RPC timeout')
    );

    const req = makeRequest('alice');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('Failed to fetch owner history');
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
});
