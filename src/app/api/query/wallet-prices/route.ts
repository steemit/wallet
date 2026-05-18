import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const prices = await SteemService.getWalletPrices();

    const response = NextResponse.json({
      success: true,
      ...prices,
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return response;
  } catch (error) {
    console.error('wallet-prices query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet prices', details: (error as Error).message },
      { status: 500 }
    );
  }
}
