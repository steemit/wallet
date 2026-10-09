import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock redis module — rate limiter uses getRedis() internally
const mockRedisInstance = {
  incr: vi.fn(),
  expire: vi.fn(),
};

const mockGetRedis = vi.fn();

vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockGetRedis(),
  redisKey: (k: string) => `wallet:${k}`,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDeleteByPrefix: vi.fn(),
}));

import { rateLimit, rateLimitByUser } from '@/lib/middleware/rate-limit';

function mockRequest(ip: string = '1.2.3.4'): NextRequest {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
  } as unknown as NextRequest;
}

describe('Redis rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(mockRedisInstance);
  });

  it('allows request under the limit', async () => {
    mockRedisInstance.incr.mockResolvedValueOnce(1);
    mockRedisInstance.expire.mockResolvedValueOnce(1);

    const result = await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    expect(result).toBeNull();
    expect(mockRedisInstance.incr).toHaveBeenCalled();
  });

  it('blocks request over the limit', async () => {
    mockRedisInstance.incr.mockResolvedValueOnce(11); // Over limit

    const result = await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    const body = await result!.json();
    expect(body.error).toBe('Too many requests');
  });

  it('sets expiry on first request in window', async () => {
    mockRedisInstance.incr.mockResolvedValueOnce(1);
    mockRedisInstance.expire.mockResolvedValueOnce(1);

    await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    expect(mockRedisInstance.expire).toHaveBeenCalled();
  });

  it('does not set expiry on subsequent requests', async () => {
    mockRedisInstance.incr.mockResolvedValueOnce(5);

    await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    expect(mockRedisInstance.expire).not.toHaveBeenCalled();
  });

  it('falls back to in-memory when Redis is unavailable', async () => {
    mockGetRedis.mockReturnValue(null);

    const result = await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    // First request in memory store → allowed
    expect(result).toBeNull();
  });

  it('falls back to in-memory when Redis commands fail (instance exists)', async () => {
    // F-1: a connected-but-erroring instance (maxclients/OOM/READONLY) must
    // NOT be treated as "Redis healthy" — the request has to be counted by
    // the memory limiter, so the (maxRequests+1)-th request is blocked.
    mockRedisInstance.incr.mockRejectedValue(
      new Error('READONLY You cannot write against a read only replica')
    );

    const config = { maxRequests: 2, windowSeconds: 60 };
    const r1 = await rateLimit(mockRequest('8.8.8.1'), 'cmdfail', config);
    const r2 = await rateLimit(mockRequest('8.8.8.1'), 'cmdfail', config);
    const r3 = await rateLimit(mockRequest('8.8.8.1'), 'cmdfail', config);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).not.toBeNull();
    expect(r3!.status).toBe(429);
    const body = await r3!.json();
    expect(body.error).toBe('Too many requests');
  });

  it('rejects (fail-closed) when Redis commands fail and memory fallback is disabled', async () => {
    process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK = 'false';
    mockRedisInstance.incr.mockRejectedValue(
      new Error('ERR max number of clients reached')
    );

    const res = await rateLimit(mockRequest('8.8.8.2'), 'cmdfail', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toBe('Rate limiter unavailable');
    delete process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK;
  });

  it('rateLimitByUser counts in memory when Redis commands fail', async () => {
    mockRedisInstance.incr.mockRejectedValue(new Error('OOM command not allowed'));

    const config = { maxRequests: 1, windowSeconds: 60 };
    const r1 = await rateLimitByUser('cmdfail-user', 'action', config);
    const r2 = await rateLimitByUser('cmdfail-user', 'action', config);

    expect(r1).toBeNull();
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });

  it('rateLimitByUser works with username', async () => {
    mockRedisInstance.incr.mockResolvedValueOnce(1);
    mockRedisInstance.expire.mockResolvedValueOnce(1);

    const result = await rateLimitByUser('alice', 'broadcast', {
      maxRequests: 5,
      windowSeconds: 60,
    });

    expect(result).toBeNull();
    expect(mockRedisInstance.incr).toHaveBeenCalledWith(
      expect.stringContaining('user:alice:broadcast')
    );
  });

  it('rateLimitByUser returns null without username', async () => {
    const result = await rateLimitByUser(null, 'broadcast', {
      maxRequests: 5,
      windowSeconds: 60,
    });

    expect(result).toBeNull();
    expect(mockRedisInstance.incr).not.toHaveBeenCalled();
  });
});
