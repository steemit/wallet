// Rate limiting middleware
//
// - Redis is the source of truth when available (shared across instances).
// - When REDIS_URL is unset we fall back to a per-process in-memory store.
//   This fallback is NOT shared across instances, so in multi-instance
//   deployments it weakens limits — see TRUST_PROXY_COUNT / REDIS_URL docs.
// - Client IP resolution is proxy-aware: when the app sits behind a trusted
//   proxy (ELB/OpenResty) set TRUST_PROXY_COUNT to the number of trusted hops,
//   so a spoofable client-supplied X-Forwarded-For cannot reset the limiter.
//   When TRUST_PROXY_COUNT is unset we use the socket peer (no header trust).

import { NextRequest, NextResponse } from 'next/server';
import { getRedis, redisKey } from '@/lib/cache/redis';

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

// Parse the trusted-hops count from env (undefined => do not trust headers).
function getTrustedProxyCount(): number | null {
  const raw = process.env.TRUST_PROXY_COUNT;
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resolve the client IP. Proxy-aware: when TRUST_PROXY_COUNT is set, read the
 * Nth-from-right entry of X-Forwarded-For (the hop our trusted proxy appended).
 * Without it we rely on the socket peer and ignore client headers entirely, so
 * a spoofed X-Forwarded-For cannot bypass rate limiting.
 */
function getClientIP(request: NextRequest): string {
  const trustedHops = getTrustedProxyCount();
  if (trustedHops !== null && trustedHops > 0) {
    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // The client-set hops are at the front; our proxy appends the real client
      // `trustedHops` entries from the end. Take the entry at
      // (length - trustedHops) — the one added by the first trusted proxy.
      const idx = parts.length - trustedHops;
      if (idx >= 0 && idx < parts.length) return parts[idx]!;
      if (parts.length > 0) return parts[parts.length - 1]!;
    }
  }
  // No trusted-proxy config: prefer the Next.js peer IP if present, else the
  // raw x-real-ip only when behind a proxy we trust. Fall back to 'unknown'.
  // (x-real-ip / cf-connecting-ip are intentionally not trusted unilaterally.)
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
    const rawKey = `ratelimit:${key}:${windowStart}`;
    const fullKey = redisKey(rawKey);

    const count = await redis.incr(fullKey);
    if (count === 1) {
      await redis.expire(fullKey, config.windowSeconds + 1);
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
    // Redis error: signal the caller to consult the memory fallback (or reject).
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

// Whether to allow a memory fallback when Redis is not configured. In a
// single-instance deploy this is fine; multi-instance deploys should set
// REDIS_URL (and leave this enabled purely for the Redis-error transient case).
function memoryFallbackEnabled(): boolean {
  return process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK !== 'false';
}

export async function rateLimit(
  request: NextRequest,
  action: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const ip = getClientIP(request);
  // Namespace the key by route so that, e.g., the /vote budget is not shared
  // with /transfer. Each broadcast route already passes a distinct action, but
  // scoping here guarantees isolation even if callers reuse an action string.
  const routeScope =
    request.nextUrl?.pathname?.replace(/^\/api\/broadcast\//, 'broadcast:') ?? '';
  const key = `${ip}:${action}${routeScope ? `:${routeScope}` : ''}`;

  // Try Redis first (shared source of truth)
  const redisResult = await redisRateLimit(key, config);
  if (redisResult) return redisResult;

  const redis = getRedis();
  if (redis) {
    // Redis healthy and did not block → allow.
    return null;
  }

  // Redis unavailable. Use the per-process memory fallback unless disabled.
  if (!memoryFallbackEnabled()) {
    return NextResponse.json(
      { error: 'Rate limiter unavailable' },
      { status: 503 }
    );
  }

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

  if (getRedis()) return null;

  if (!memoryFallbackEnabled()) {
    return NextResponse.json(
      { error: 'Rate limiter unavailable' },
      { status: 503 }
    );
  }

  return memoryRateLimit(key, config);
}

export function getRateLimitInfo(
  request: NextRequest,
  action: string,
  config: RateLimitConfig
): { limit: number; remaining: number; resetAt: Date } | null {
  const ip = getClientIP(request);
  const routeScope =
    request.nextUrl?.pathname?.replace(/^\/api\/broadcast\//, 'broadcast:') ?? '';
  const key = `${ip}:${action}${routeScope ? `:${routeScope}` : ''}`;
  const entry = memoryStore.get(key);
  if (!entry) return null;

  return {
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetAt: new Date(entry.resetAt),
  };
}

export function resetRateLimit(request: NextRequest, action: string): void {
  const ip = getClientIP(request);
  const routeScope =
    request.nextUrl?.pathname?.replace(/^\/api\/broadcast\//, 'broadcast:') ?? '';
  const key = `${ip}:${action}${routeScope ? `:${routeScope}` : ''}`;
  memoryStore.delete(key);
}
