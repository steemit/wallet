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

import { rateLimit, rateLimitByUser } from '@/lib/middleware/rate-limit';

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

  it('falls back to x-real-ip when TRUST_PROXY_COUNT is unset', async () => {
    delete process.env.TRUST_PROXY_COUNT;
    // Without TRUST_PROXY_COUNT, x-real-ip (set by the reverse proxy) is used.
    // Two requests from different x-real-ip get separate buckets.
    const r1 = await rateLimit(
      makeReq({ 'x-real-ip': '1.1.1.1' }),
      'broadcast',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r1).toBeNull(); // allowed
    const r2 = await rateLimit(
      makeReq({ 'x-real-ip': '2.2.2.2' }),
      'broadcast',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r2).toBeNull(); // also allowed — different IP, different bucket
  });

  it('falls back to "unknown" when neither TRUST_PROXY_COUNT nor x-real-ip is present', async () => {
    delete process.env.TRUST_PROXY_COUNT;
    // No x-real-ip, no TRUST_PROXY_COUNT → all collapse to 'unknown'.
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

describe('rate-limit route scope (F14: dynamic segments must not enter the key)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null); // memory fallback → observable buckets
  });

  it('recovery/verify: rotating the [code] param does NOT yield a fresh counter', async () => {
    // The attack: each guess used a new key, defeating the anti-enumeration
    // limit and allocating unbounded Redis keys. After normalization all
    // codes share one bucket.
    const r1 = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.1' }, '/api/recovery/verify/aaaaaaaaaaaaaaaaaaaa'), 'recovery_verify', {
      maxRequests: 1,
      windowSeconds: 300,
    });
    expect(r1).toBeNull(); // first guess allowed

    // Different code, same normalized bucket → blocked.
    const r2 = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.1' }, '/api/recovery/verify/bbbbbbbbbbbbbbbbbbbb'), 'recovery_verify', {
      maxRequests: 1,
      windowSeconds: 300,
    });
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });

  it('broadcast routes keep per-op scoping', async () => {
    await rateLimit(makeReq({ 'x-real-ip': '10.0.0.2' }, '/api/broadcast/vote'), 'broadcast', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    // Same route: shared bucket → blocked
    const same = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.2' }, '/api/broadcast/vote'), 'broadcast', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    expect(same!.status).toBe(429);
    // Different broadcast route: separate bucket → allowed
    const other = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.2' }, '/api/broadcast/transfer'), 'broadcast', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    expect(other).toBeNull();
  });

  it('static query paths keep distinct buckets', async () => {
    await rateLimit(makeReq({ 'x-real-ip': '10.0.0.3' }, '/api/query/history'), 'query', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    const same = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.3' }, '/api/query/history'), 'query', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    expect(same!.status).toBe(429);
    const other = await rateLimit(makeReq({ 'x-real-ip': '10.0.0.3' }, '/api/query/witnesses'), 'query', {
      maxRequests: 1,
      windowSeconds: 60,
    });
    expect(other).toBeNull();
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
