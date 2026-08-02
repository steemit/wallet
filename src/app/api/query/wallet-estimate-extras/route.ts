import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { hashedCacheKey } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const username = request.nextUrl.searchParams.get('username')?.trim().toLowerCase();
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    const includeOpenOrders =
      request.nextUrl.searchParams.get('includeOpenOrders') === 'true';

    try {
      const result = await withCache(
        hashedCacheKey('cache:query:wallet-estimate-extras', username, includeOpenOrders),
        60,
        600,
        () => SteemService.getWalletEstimateExtras(username, { includeOpenOrders })
      );

      const response = NextResponse.json({
        success: true,
        ...result.data,
        ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
      });
      response.headers.set('Cache-Control', 'public, s-maxage=60');
      if (result.degraded) response.headers.set('X-Degraded', 'true');
      return response;
    } catch (error) {
      console.error('wallet-estimate-extras query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch wallet estimate extras', degraded: true },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('wallet-estimate-extras query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet estimate extras'},
      { status: 500 }
    );
  }
}
