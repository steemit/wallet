import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock middleware — rate limiting is the security behavior under test.
// rateLimitConfigFromEnv keeps its real implementation (via importOriginal)
// so the env-override behavior is exercised end to end.
const mockRateLimit = vi.fn();
const mockRateLimitByUser = vi.fn();
vi.mock('@/lib/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/middleware')>();
  return {
    ...actual,
    setCSRFToken: vi.fn(),
    rateLimit: (...args: unknown[]) => mockRateLimit(...args),
    rateLimitByUser: (...args: unknown[]) => mockRateLimitByUser(...args),
    verifyCSRF: vi.fn(),
  };
});

// Mock SteemService
const mockGenerateChallenge = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    generateChallenge: (...args: unknown[]) => mockGenerateChallenge(...args),
  },
}));

// Mock Redis
const mockRedisSet = vi.fn();
const mockGetRedis = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockGetRedis(),
  redisKey: (k: string) => `wallet:${k}`,
}));

import { GET } from '@/app/api/auth/challenge/route';

function makeRequest(username?: string): NextRequest {
  const qs = username ? `?username=${encodeURIComponent(username)}` : '';
  return new NextRequest(`http://localhost/api/auth/challenge${qs}`);
}

describe('GET /api/auth/challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_AUTH_CHALLENGE_MAX;
    delete process.env.RATE_LIMIT_AUTH_CHALLENGE_WINDOW;
    mockRateLimit.mockResolvedValue(null);
    mockRateLimitByUser.mockResolvedValue(null);
    mockGenerateChallenge.mockReturnValue('login-alice-123-abc');
    mockGetRedis.mockReturnValue({ set: mockRedisSet });
  });

  it('generates and stores a challenge for a valid username', async () => {
    const res = await GET(makeRequest('alice'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.challenge).toBe('login-alice-123-abc');
    expect(mockRedisSet).toHaveBeenCalledWith(
      'wallet:auth:challenge:alice',
      expect.stringContaining('login-alice-123-abc'),
      'EX',
      300
    );
  });

  it('returns 400 when username is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid username format (before any Redis write)', async () => {
    const res = await GET(makeRequest('Bad Name!'));
    expect(res.status).toBe(400);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-IP rate limit trips', async () => {
    mockRateLimit.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const res = await GET(makeRequest('alice'));
    expect(res.status).toBe(429);
    // Per-username limiter must not run once IP limit already blocked.
    expect(mockRateLimitByUser).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-username rate limit trips (targeted auth-DoS guard)', async () => {
    mockRateLimitByUser.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const res = await GET(makeRequest('alice'));
    expect(res.status).toBe(429);
    // The overwrite attack vector: challenge must NOT be written when limited.
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('rate limits with the auth_challenge action at 10/min', async () => {
    await GET(makeRequest('alice'));
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'auth_challenge',
      { maxRequests: 10, windowSeconds: 60 }
    );
    expect(mockRateLimitByUser).toHaveBeenCalledWith('alice', 'auth_challenge', {
      maxRequests: 10,
      windowSeconds: 60,
    });
  });

  it('honours RATE_LIMIT_AUTH_CHALLENGE_MAX / _WINDOW overrides', async () => {
    process.env.RATE_LIMIT_AUTH_CHALLENGE_MAX = '3';
    process.env.RATE_LIMIT_AUTH_CHALLENGE_WINDOW = '120';
    await GET(makeRequest('alice'));
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'auth_challenge',
      { maxRequests: 3, windowSeconds: 120 }
    );
    expect(mockRateLimitByUser).toHaveBeenCalledWith('alice', 'auth_challenge', {
      maxRequests: 3,
      windowSeconds: 120,
    });
  });

  it('falls back to defaults when the env overrides are invalid', async () => {
    process.env.RATE_LIMIT_AUTH_CHALLENGE_MAX = 'abc';
    process.env.RATE_LIMIT_AUTH_CHALLENGE_WINDOW = '0';
    await GET(makeRequest('alice'));
    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'auth_challenge',
      { maxRequests: 10, windowSeconds: 60 }
    );
  });
});
