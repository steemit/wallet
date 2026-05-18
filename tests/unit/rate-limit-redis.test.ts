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

  it('falls back to in-memory when Redis throws', async () => {
    mockRedisInstance.incr.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await rateLimit(mockRequest(), 'query', {
      maxRequests: 10,
      windowSeconds: 60,
    });

    // Falls back to memory, first request → allowed
    expect(result).toBeNull();
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
