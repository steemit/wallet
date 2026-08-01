// GET /api/query/market?username=&since=
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { hashedCacheKey } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 120,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = request.nextUrl;
    const username = searchParams.get('username')?.trim().toLowerCase() || undefined;
    const since = searchParams.get('since')?.trim() || undefined;

    // Cache to avoid fanning out 4 parallel RPCs per request (DoS amplifier).
    // Short TTL: market data changes frequently; stale-while-revalidate covers
    // transient failures. User-specific openOrders are included but the key is
    // scoped by username so no cross-user leakage.
    const cacheKey = hashedCacheKey('cache:query:market', username ?? '-', since ?? '-');
    const result = await withCache(cacheKey, 5, 30, async () => {
      const [orderbook, ticker, trades, openOrders] = await Promise.all([
        SteemService.getMarketOrderBook(),
        SteemService.getMarketTicker(),
        since
          ? SteemService.getMarketTradeHistorySince(since)
          : SteemService.getMarketRecentTrades(),
        username ? SteemService.getMarketOpenOrders(username) : Promise.resolve([]),
      ]);

      return {
        orderbook,
        ticker,
        trades: trades.map((t) => ({ ...t, date: t.date.toISOString() })),
        openOrders,
      };
    });

    const response = NextResponse.json({
      success: true,
      ...result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=30');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Market query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}
