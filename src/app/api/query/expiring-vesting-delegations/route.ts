// GET /api/query/expiring-vesting-delegations?account=user1
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

    const { searchParams } = new URL(request.url);
    const rawAccount = searchParams.get('account');
    const account = rawAccount ? normalizeAccountForCache(rawAccount) : undefined;

    if (!account) {
      return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 });
    }

    const cacheKey = hashedCacheKey('cache:query:expiring-vesting-delegations', account);
    const result = await withCache(cacheKey, 15, 120, () =>
      SteemService.getExpiringVestingDelegations(account)
    );

    const response = NextResponse.json({
      success: true,
      delegations: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    // Per-account delegation rows — private caching prevents cross-user CDN
    // poisoning (same pattern as the other user-scoped query routes).
    response.headers.set('Cache-Control', 'private, max-age=15');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching expiring vesting delegations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch expiring vesting delegations', degraded: true },
      { status: 503 }
    );
  }
}
