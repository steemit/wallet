// Rate limiting middleware
import { NextRequest, NextResponse } from 'next/server';

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

// In-memory rate limit store
// In production, use Redis or similar
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries from the store
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}

/**
 * Get client IP address from request
 */
function getClientIP(request: NextRequest): string {
  // Check various headers for IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    const parts = forwardedFor.split(',');
    return parts[0]?.trim() || 'unknown';
  }

  if (realIP) {
    return realIP;
  }

  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  // Fallback to a generic identifier
  return 'unknown';
}

/**
 * Rate limit by IP address
 * Returns error response if limit exceeded, null if OK
 */
export async function rateLimit(
  request: NextRequest,
  action: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Get or create entry
  let entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // Create new entry
    entry = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
    return null;
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        error: 'Too many requests',
        retryAfter,
      },
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

  // Update entry
  rateLimitStore.set(key, entry);

  // Add rate limit headers to successful requests
  return null;
}

/**
 * Rate limit by username (for authenticated users)
 * Returns error response if limit exceeded, null if OK
 */
export async function rateLimitByUser(
  username: string | null,
  action: string,
  config: RateLimitConfig
): Promise<NextResponse | null> {
  if (!username) {
    // Fall back to IP-based rate limiting if no username
    return null;
  }

  const key = `user:${username}:${action}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Get or create entry
  let entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // Create new entry
    entry = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
    return null;
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      {
        error: 'Too many requests',
        retryAfter,
      },
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

  // Update entry
  rateLimitStore.set(key, entry);

  return null;
}

/**
 * Get rate limit info for a key
 */
export function getRateLimitInfo(
  request: NextRequest,
  action: string
): { limit: number; remaining: number; resetAt: Date } | null {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return null;
  }

  return {
    limit: entry.count,
    remaining: Math.max(0, entry.count),
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Reset rate limit for a key (admin function)
 */
export function resetRateLimit(request: NextRequest, action: string): void {
  const ip = getClientIP(request);
  const key = `${ip}:${action}`;
  rateLimitStore.delete(key);
}
