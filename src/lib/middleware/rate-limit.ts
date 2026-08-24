// Rate limiting middleware
//
// - Redis is the source of truth when available (shared across instances).
// - When REDIS_URL is unset we fall back to a per-process in-memory store.
//   This fallback is NOT shared across instances, so in multi-instance
//   deployments it weakens limits — see TRUST_PROXY_COUNT / REDIS_URL docs.
// - Client IP resolution is proxy-aware: when the app sits behind a trusted
//   proxy (ELB/OpenResty) set TRUST_PROXY_COUNT to the number of trusted hops,
//   so a spoofable client-supplied X-Forwarded-For cannot reset the limiter.
//   When TRUST_PROXY_COUNT is unset we fall back to x-real-ip (set by the
//   reverse proxy, which overwrites any client value), then 'unknown'.

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

// Parse the trusted-hops count from env (undefined => do not trust XFF).
function getTrustedProxyCount(): number | null {
  const raw = process.env.TRUST_PROXY_COUNT;
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

let warnedMissingProxyConfig = false;

/**
 * Resolve the client IP.
 *
 * Priority:
 * 1. TRUST_PROXY_COUNT set: read the Nth-from-right entry of X-Forwarded-For
 *    (the hop our trusted proxy appended). This is the most spoof-resistant.
 * 2. TRUST_PROXY_COUNT unset: fall back to x-real-ip. The reverse proxy
 *    (OpenResty/ELB) sets this header by OVERWRITING any client value, so it
 *    is far harder to spoof than X-Forwarded-For (which is append-only). This
 *    prevents the rate-limit bucket from collapsing to a single 'unknown' key
 *    when an operator forgets to set TRUST_PROXY_COUNT.
 * 3. Neither available: 'unknown' (all clients share one bucket — degraded).
 */
export function getClientIP(request: NextRequest): string {
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

  // No TRUST_PROXY_COUNT: fall back to x-real-ip (set by the reverse proxy,
  // which overwrites client-supplied values). This prevents the limiter from
  // collapsing all clients into a single 'unknown' bucket.
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Truly nothing to go on. Warn once in production so operators notice.
  if (!warnedMissingProxyConfig && process.env.NODE_ENV === 'production') {
    console.warn(
      'rate-limit: TRUST_PROXY_COUNT is not set and x-real-ip is absent — ' +
        'all clients share a single rate-limit bucket. Set TRUST_PROXY_COUNT ' +
        'or ensure the reverse proxy sets x-real-ip.'
    );
    warnedMissingProxyConfig = true;
  }
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

/**
 * Build a RateLimitConfig from environment variables so limits can be tuned
 * at deploy time without a code change. Convention: `<PREFIX>_MAX` is the
 * max requests per window and `<PREFIX>_WINDOW` the window length in
 * seconds; unset or non-positive values fall back to `defaults`.
 */
export function rateLimitConfigFromEnv(
  prefix: string,
  defaults: RateLimitConfig
): RateLimitConfig {
  const max = Number(process.env[`${prefix}_MAX`]);
  const window = Number(process.env[`${prefix}_WINDOW`]);
  return {
    maxRequests:
      Number.isInteger(max) && max > 0 ? max : defaults.maxRequests,
    windowSeconds:
      Number.isInteger(window) && window > 0 ? window : defaults.windowSeconds,
  };
}

// Whether to allow a memory fallback when Redis is not configured. In a
// single-instance deploy this is fine; multi-instance deploys should set
// REDIS_URL (and leave this enabled purely for the Redis-error transient case).
function memoryFallbackEnabled(): boolean {
  return process.env.RATE_LIMIT_ALLOW_MEMORY_FALLBACK !== 'false';
}

/**
 * Normalize a request pathname into a rate-limit route scope WITHOUT any
 * attacker-controlled dynamic segments.
 *
 * The raw pathname must never enter the key directly: dynamic route params
 * (e.g. /api/recovery/verify/[code]) are chosen by the caller before any
 * format validation, so an attacker rotating the param would get a fresh
 * counter on every request — defeating the limit and allocating unbounded
 * Redis keys (301s TTL each).
 *
 * Output format (enforced for ALL branches): no leading '/', segments
 * colon-separated, lowercase — e.g. 'broadcast:vote', 'recovery:verify',
 * 'api:query:history'. Keys therefore never contain '/'.
 *
 * Encoding note: Next.js's nextUrl.pathname is ALREADY percent-decoded,
 * so an encoded slash (%2F) arrives as a literal '/'. Prefix matching below
 * (rather than strict anchored regexes) ensures decoded segments, trailing
 * garbage, and query strings can never smuggle a varying part into the key.
 *
 * When adding a new dynamic route under /api/, register its pattern here.
 */
function routeScopeOf(pathname: string): string {
  // Broadcast routes: keep only the fixed op segment (a Next.js route
  // directory name — lowercase letters/digits/hyphens); drop any tail.
  const broadcast = pathname.match(/^\/api\/broadcast\/([^/]+)/);
  if (broadcast?.[1]) return `broadcast:${broadcast[1].toLowerCase()}`;

  // /api/recovery/verify/[code] is the ONLY dynamic route: collapse the
  // entire param (including any decoded slashes) to one stable scope.
  if (pathname.startsWith('/api/recovery/verify/')) return 'recovery:verify';

  // Static /api paths (no dynamic segments today): canonicalize.
  return pathname.replace(/^\//, '').replace(/\//g, ':').toLowerCase();
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
  const routeScope = request.nextUrl?.pathname
    ? routeScopeOf(request.nextUrl.pathname)
    : '';
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
