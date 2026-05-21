// GET /api/query/price
// Get STEEM price information from feed history
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { applyRpcOverride } from '@/lib/api/with-rpc-override';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const result = await applyRpcOverride(request, () =>
      withCache('cache:query:price', 60, 600, async () => {
        const feedHistory = await SteemService.getFeedHistory();

        const history = feedHistory as Record<string, unknown> | undefined;
        const medianHistory = history?.current_median_history as Record<string, unknown> | undefined;
        const currentPrice = (medianHistory?.base_quote as string) || '0.000 SBD';

        const priceMatch = currentPrice.match(/[\d.]+/);
        const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
        const priceHistory = (history?.price_history as unknown[]) || [];

        return {
          price: { sbd: price, base: currentPrice, timestamp: new Date().toISOString() },
          history: priceHistory.slice(0, 7),
        };
      })
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
    console.error('Error fetching price:', error);
    return NextResponse.json(
      { error: 'Failed to fetch price', degraded: true },
      { status: 503 }
    );
  }
}
