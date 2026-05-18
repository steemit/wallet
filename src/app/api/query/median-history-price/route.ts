// GET /api/query/median-history-price
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const price = await SteemService.getCurrentMedianHistoryPrice();

    const response = NextResponse.json({
      success: true,
      ...price,
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60');
    return response;
  } catch (error) {
    console.error('median-history-price query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch median history price', details: (error as Error).message },
      { status: 500 }
    );
  }
}
