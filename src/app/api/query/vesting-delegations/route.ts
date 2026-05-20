// GET /api/query/vesting-delegations?account=user1
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const account = searchParams.get('account')?.trim();

    if (!account) {
      return NextResponse.json({ error: 'Missing account parameter' }, { status: 400 });
    }

    const cacheKey = `cache:query:vesting-delegations:${account}`;
    const result = await withCache(cacheKey, 15, 120, () =>
      SteemService.getVestingDelegations(account)
    );

    const response = NextResponse.json({
      success: true,
      delegations: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching vesting delegations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vesting delegations' },
      { status: 500 }
    );
  }
}
