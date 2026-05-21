// GET /api/query/median-history-price
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { applyRpcOverride } from '@/lib/api/with-rpc-override';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    try {
      const result = await applyRpcOverride(request, () =>
        withCache('cache:query:median-history-price', 60, 600, () =>
          SteemService.getCurrentMedianHistoryPrice()
        )
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
      console.error('median-history-price query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch median history price', degraded: true },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('median-history-price query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch median history price', details: (error as Error).message },
      { status: 500 }
    );
  }
}
