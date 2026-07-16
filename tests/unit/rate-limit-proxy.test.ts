import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetRedis = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockGetRedis(),
  redisKey: (k: string) => `wallet:${k}`,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDeleteByPrefix: vi.fn(),
}));

import { rateLimit, rateLimitByUser, getRateLimitInfo } from '@/lib/middleware/rate-limit';

function makeReq(headers: Record<string, string> = {}, path = '/api/broadcast/transfer'): NextRequest {
  const url = new URL(`http://localhost${path}`);
  return new NextRequest(url, { headers: new Headers(headers) });
}

describe('rate-limit proxy-aware client IP (TRUST_PROXY_COUNT)', () => {
  const orig = process.env.TRUST_PROXY_COUNT;

  afterEach(() => {
    if (orig === undefined) delete process.env.TRUST_PROXY_COUNT;
    else process.env.TRUST_PROXY_COUNT = orig;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null); // use memory fallback
  });

  it('uses the Nth-from-right XFF entry when TRUST_PROXY_COUNT is set', async () => {
    process.env.TRUST_PROXY_COUNT = '1';
    // 2 requests from "spoof,real" — with 1 trusted hop, the real IP is the last entry.
    // First request should be allowed.
    const r1 = await rateLimit(
      makeReq({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }),
      'broadcast',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r1).toBeNull();
    // Second request from a DIFFERENT spoof prefix but same real IP should be blocked.
    const r2 = await rateLimit(
      makeReq({ 'x-forwarded-for': '2.2.2.2, 9.9.9.9' }),
      'broadcast',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });

  it('falls back to "unknown" when TRUST_PROXY_COUNT is unset (ignores XFF)', async () => {
    delete process.env.TRUST_PROXY_COUNT;
    // Two requests with different XFF but both resolve to "unknown" → shared bucket.
    await rateLimit(makeReq({ 'x-forwarded-for': '1.1.1.1' }), 'broadcast', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    const r2 = await rateLimit(makeReq({ 'x-forwarded-for': '2.2.2.2' }), 'broadcast', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });
});

describe('rate-limit fail-closed when memory fallback disabled', () => {
  afterEach(() => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = undefined;
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null); // no Redis
  });

  it('returns 503 when Redis is down and fallback is disabled', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'false';
    const res = await rateLimit(makeReq(), 'broadcast', { maxRequests: 10, windowSeconds: 60 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });

  it('uses memory fallback when Redis is down and fallback is enabled (default)', async () => {
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK;
    const res = await rateLimit(makeReq(), 'broadcast', { maxRequests: 10, windowSeconds: 60 });
    expect(res).toBeNull(); // allowed (first request under limit)
  });
});

describe('rateLimitByUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null);
  });

  it('returns null (no limit) when username is null', async () => {
    expect(await rateLimitByUser(null, 'action', { maxRequests: 5, windowSeconds: 60 })).toBeNull();
  });

  it('blocks after exceeding the per-user limit in memory', async () => {
    await rateLimitByUser('alice', 'action', { maxRequests: 1, windowSeconds: 60 });
    const r2 = await rateLimitByUser('alice', 'action', { maxRequests: 1, windowSeconds: 60 });
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });

  it('returns 503 when Redis down and fallback disabled', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'false';
    const res = await rateLimitByUser('bob', 'action', { maxRequests: 5, windowSeconds: 60 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK;
  });
});

describe('getRateLimitInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null);
  });

  it('returns null when no entry exists', () => {
    // Use a unique action so no prior test pollutes the memory bucket.
    const info = getRateLimitInfo(makeReq(), 'never-used-action', { maxRequests: 10, windowSeconds: 60 });
    expect(info).toBeNull();
  });

  it('returns limit/remaining after a request', async () => {
    const req = makeReq({}, '/api/broadcast/vote');
    await rateLimit(req, 'broadcast', { maxRequests: 5, windowSeconds: 60 });
    const info = getRateLimitInfo(req, 'broadcast', { maxRequests: 5, windowSeconds: 60 });
    expect(info).not.toBeNull();
    expect(info!.limit).toBe(5);
    expect(info!.remaining).toBe(4);
  });
});
