// GET /api/query/withdraw-routes?username=name
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { hashedCacheKey, normalizeAccountForCache } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const rawUsername = request.nextUrl.searchParams.get('username');
    const username = rawUsername ? normalizeAccountForCache(rawUsername) : undefined;
    if (!username) {
      return NextResponse.json({ error: 'Missing username' }, { status: 400 });
    }

    const result = await withCache(
      hashedCacheKey('cache:query:withdraw-routes', username),
      60,
      600,
      () => SteemService.getWithdrawRoutesOutgoing(username)
    );

    const response = NextResponse.json({
      success: true,
      routes: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    // Unified upstream-failure protocol (§3.6): 503 + degraded body. A single
    // catch — no inner catch whose 503 could be shadowed by an outer 500.
    console.error('withdraw-routes query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch withdraw routes', degraded: true },
      { status: 503 }
    );
  }
}
