import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const result = await withCache('cache:query:wallet-prices', 60, 600, () =>
      SteemService.getWalletPrices()
    );

    const response = NextResponse.json({
      success: true,
      ...result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('wallet-prices query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet prices', degraded: true },
      { status: 503 }
    );
  }
}
