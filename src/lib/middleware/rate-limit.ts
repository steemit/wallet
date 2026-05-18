// Rate limiting middleware
// Uses Redis when available, falls back to in-memory Map

import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/cache/redis';

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

// In-memory fallback for when Redis is unavailable
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetAt) memoryStore.delete(key);
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  if (forwardedFor) {
    const parts = forwardedFor.split(',');
    return parts[0]?.trim() || 'unknown';
  }
  if (realIP) return realIP;
  if (cfConnectingIP) return cfConnectingIP;
  return 'unknown';
}

async function redisRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const windowStart = Math.floor(Date.now() / (config.windowSeconds * 1000));
    const redisKey = `ratelimit:${key}:${windowStart}`;

    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, config.windowSeconds + 1);
    }

    if (count > config.maxRequests) {
      const retryAfter = config.windowSeconds;
      return NextResponse.json(
        { error: 'Too many requests', retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    return null;
  } catch {
    return null;
  }
}

function memoryRateLimit(
  key: string,
  config: RateLimitConfig
): NextResponse | null {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  let entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    memoryStore.set(key, entry);
    return null;
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: 'Too many requests', retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(entry.resetAt).toISOString(),
        },
      }
    );
  }

  return null;
}

export async function rateLimit(
  request: NextRequest,
  action: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;

  // Try Redis first
  const redisResult = await redisRateLimit(key, config);
  if (redisResult) return redisResult;

  // Fallback to in-memory (also used when Redis is available but didn't block)
  const memoryResult = memoryRateLimit(key, config);
  if (memoryResult) return memoryResult;

  return null;
}

export async function rateLimitByUser(
  username: string | null,
  action: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  if (!username) return null;

  const key = `user:${username}:${action}`;

  const redisResult = await redisRateLimit(key, config);
  if (redisResult) return redisResult;

  return memoryRateLimit(key, config);
}

export function getRateLimitInfo(
  request: NextRequest,
  action: string
): { limit: number; remaining: number; resetAt: Date } | null {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;
  const entry = memoryStore.get(key);
  if (!entry) return null;

  return {
    limit: entry.count,
    remaining: Math.max(0, config_maxRequests - entry.count),
    resetAt: new Date(entry.resetAt),
  };
}

const config_maxRequests = 100;

export function resetRateLimit(request: NextRequest, action: string): void {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;
  memoryStore.delete(key);
}
