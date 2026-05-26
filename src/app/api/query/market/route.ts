// GET /api/query/market?username=&since=
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

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

    const [orderbook, ticker, trades, openOrders] = await Promise.all([
      SteemService.getMarketOrderBook(),
      SteemService.getMarketTicker(),
      since
        ? SteemService.getMarketTradeHistorySince(since)
        : SteemService.getMarketRecentTrades(),
      username ? SteemService.getMarketOpenOrders(username) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      success: true,
      orderbook,
      ticker,
      trades: trades.map((t) => ({
        ...t,
        date: t.date.toISOString(),
      })),
      openOrders,
    });
  } catch (error) {
    console.error('Market query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data', details: (error as Error).message },
      { status: 500 }
    );
  }
}
