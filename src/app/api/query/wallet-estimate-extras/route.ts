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

    const username = request.nextUrl.searchParams.get('username')?.trim().toLowerCase();
    if (!username) {
      return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    const includeOpenOrders =
      request.nextUrl.searchParams.get('includeOpenOrders') === 'true';

    const extras = await SteemService.getWalletEstimateExtras(username, {
      includeOpenOrders,
    });

    const response = NextResponse.json({
      success: true,
      ...extras,
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60');
    return response;
  } catch (error) {
    console.error('wallet-estimate-extras query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet estimate extras', details: (error as Error).message },
      { status: 500 }
    );
  }
}
