// GET /api/query/price
// Get STEEM price information from feed history
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const feedHistory = await SteemService.getFeedHistory();

    // Calculate current price from feed history
    // The base is the median price in SBD
    // The quote is 1 STEEM
    const history = feedHistory as Record<string, unknown> | undefined;
    const medianHistory = history?.current_median_history as Record<string, unknown> | undefined;
    const currentPrice = (medianHistory?.base_quote as string) || '0.000 SBD';

    // Parse price (format: "1.234 SBD")
    const priceMatch = currentPrice.match(/[\d.]+/);
    const price = priceMatch ? parseFloat(priceMatch[0]) : 0;

    // Get previous prices for history
    const priceHistory = (history?.price_history as unknown[]) || [];

    const response = NextResponse.json({
      success: true,
      price: {
        sbd: price,
        base: currentPrice,
        timestamp: new Date().toISOString(),
      },
      history: priceHistory.slice(0, 7), // Last 7 days
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60');
    return response;
  } catch (error) {
    console.error('Error fetching price:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price', details: (error as Error).message },
      { status: 500 }
    );
  }
}
