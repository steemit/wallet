// GET /api/query/market?username=&since=
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { hashedCacheKey, normalizeAccountForCache } from '@/lib/cache/cache-key';

/**
 * The client polls every few seconds with a fresh `since` cursor (ISO
 * timestamp of the newest trade it already has). Keying the cache on the raw
 * value mints a unique key per user per poll — the cache never engages for
 * logged-in traffic and a single user rotating arbitrary `since` values can
 * balloon the Redis keyspace. Instead the cursor is quantized to a 30-second
 * bucket for KEYING ONLY (>= the client poll interval): every poll inside one
 * bucket shares a cache entry, and the keyspace is bounded to ~2 entries per
 * user per minute. The upstream call still uses the precise timestamp.
 *
 * Tradeoff: the delta-window start can be up to ~30s older than requested, so
 * a response may repeat a few trades the client already has. The client
 * dedupes trade rows by key (use-market-data), so this is bounded staleness
 * traded for the cache actually engaging. Anonymous bucket entries are shared
 * cross-user, so an anonymous visitor whose cursor is older than the first
 * filler's can silently skip trades from the gap window until remount (bounded
 * by the bucket width); logged-in users are keyed per-user and unaffected.
 */
const SINCE_BUCKET_MS = 30_000;

// ISO-8601 date-time the client sends (YYYY-MM-DDTHH:mm:ss, optionally with
// fractional seconds and/or a Z suffix — see use-market-data).
const SINCE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z)?$/;

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 120,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = request.nextUrl;
    // Normalize so /?username=Alice and /?username=alice share one cache entry.
    const rawUsername = searchParams.get('username');
    const username = rawUsername ? normalizeAccountForCache(rawUsername) : undefined;
    const rawSince = searchParams.get('since')?.trim() || undefined;

    // Validate `since` up front: garbage must be a 400, not silently forwarded
    // upstream or hashed into the keyspace.
    let since: string | undefined;
    if (rawSince) {
      if (!SINCE_FORMAT.test(rawSince) || Number.isNaN(Date.parse(rawSince))) {
        return NextResponse.json({ error: 'Invalid since parameter' }, { status: 400 });
      }
      since = rawSince;
    }

    // Quantize `since` to a 30s bucket for the cache key (see SINCE_BUCKET_MS).
    const sinceBucket = since ? Math.floor(Date.parse(since) / SINCE_BUCKET_MS) : undefined;
    const cacheKey = hashedCacheKey('cache:query:market', username ?? '-', sinceBucket ?? '-');

    // Cache to avoid fanning out 4 parallel RPCs per request (DoS amplifier).
    // Short TTL: market data changes frequently; stale-while-revalidate covers
    // transient failures. User-specific openOrders are included but the key is
    // scoped by username so no cross-user leakage.
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
    // With a username the response includes that user's open orders, so use
    // private caching to prevent cross-user CDN poisoning. Anonymous
    // responses contain only global orderbook/ticker/trades data.
    response.headers.set(
      'Cache-Control',
      username
        ? 'private, max-age=5'
        : 'public, s-maxage=5, stale-while-revalidate=30'
    );
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Market query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data', degraded: true },
      { status: 503 }
    );
  }
}
