// GET /api/query/owner-history?username=name
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { hashedCacheKey, normalizeAccountForCache } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', { maxRequests: 30, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    // Normalize so differently-cased spellings hit the same upstream account.
    const username = normalizeAccountForCache(
      new URL(request.url).searchParams.get('username') ?? ''
    );
    if (!username) {
      return NextResponse.json({ error: 'username required' }, { status: 400 });
    }

    // Owner history changes only when the owner authority changes; a short
    // fresh window keeps the recovery flow current while stale-while-error
    // covers upstream blips (same §3.6 protocol as the sibling query routes).
    const result = await withCache(
      hashedCacheKey('cache:query:owner-history', username),
      15,
      300,
      () => SteemService.getOwnerHistory(username)
    );

    const response = NextResponse.json({
      success: true,
      history: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    // Per-account rows — private caching prevents cross-user CDN poisoning.
    response.headers.set('Cache-Control', 'private, max-age=15');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('owner-history error:', error);
    // Unified upstream-failure protocol (§3.6): 503 + degraded body.
    return NextResponse.json(
      { error: 'Failed to fetch owner history', degraded: true },
      { status: 503 }
    );
  }
}
