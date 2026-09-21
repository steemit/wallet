// GET /api/query/accounts?names=user1,user2
// Get account information
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { normalizeAccountForCache } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 100,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const namesParam = searchParams.get('names');

    if (!namesParam) {
      return NextResponse.json(
        { error: 'Missing names parameter' },
        { status: 400 }
      );
    }

    // Normalize every name (trim + strip '@' + lowercase): the same account
    // list must map to one cache key and one upstream call whatever casing
    // the client sent.
    const usernames = namesParam.split(',').map((s) => normalizeAccountForCache(s)).filter(Boolean);

    if (usernames.length === 0) {
      return NextResponse.json(
        { error: 'No usernames provided' },
        { status: 400 }
      );
    }

    if (usernames.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 accounts per request' },
        { status: 400 }
      );
    }

    // Hash the full normalized list for the cache key so distinct long username
    // lists that share a 200-char prefix do not collide in cache.
    const cacheKey = `cache:query:accounts:${createHash('sha256').update(usernames.join(',')).digest('hex').slice(0, 32)}`;
    const result = await withCache(cacheKey, 10, 300, () =>
      SteemService.getAccounts(usernames)
    );

    const response = NextResponse.json({
      success: true,
      accounts: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts', degraded: true },
      { status: 503 }
    );
  }
}
