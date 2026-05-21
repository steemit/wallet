// GET /api/query/history?username=user&limit=100
// Get account transaction history with degradation fallback
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { getRedis } from '@/lib/cache/redis';
import { isSteemKnownDown, markSteemHealthy, markSteemUnhealthy } from '@/lib/cache/health-monitor';
import { applyRpcOverride } from '@/lib/api/with-rpc-override';

const FALLBACK_TTL = 300; // 5 minutes

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 50,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const fromParam = searchParams.get('from');
    const from = fromParam !== null ? parseInt(fromParam, 10) : -1;

    if (!username) {
      return NextResponse.json(
        { error: 'Missing username parameter' },
        { status: 400 }
      );
    }

    if (limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    if (fromParam !== null && (!Number.isFinite(from) || from < -1)) {
      return NextResponse.json(
        { error: 'Invalid from parameter' },
        { status: 400 }
      );
    }

    // If Steem is known down, try fallback immediately
    if (await isSteemKnownDown()) {
      const fallback = await getFallback(username);
      if (fallback) {
        return degradedResponse(fallback);
      }
    }

    try {
      const history = await applyRpcOverride(request, () =>
        SteemService.getAccountHistory(username, limit, from)
      );
      await markSteemHealthy();

      // Store successful response as fallback (only for first page / from=-1)
      if (from === -1) {
        await saveFallback(username, history);
      }

      return NextResponse.json({ success: true, history });
    } catch (error) {
      await markSteemUnhealthy((error as Error).message);

      // Try fallback data
      const fallback = await getFallback(username);
      if (fallback) {
        return degradedResponse(fallback);
      }

      throw error;
    }
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history', details: (error as Error).message },
      { status: 500 }
    );
  }
}

function degradedResponse(history: unknown[]) {
  const response = NextResponse.json({
    success: true,
    history,
    degraded: true,
  });
  response.headers.set('X-Degraded', 'true');
  return response;
}

async function getFallback(username: string): Promise<unknown[] | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`cache:query:history-fallback:${username}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveFallback(username: string, history: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      `cache:query:history-fallback:${username}`,
      JSON.stringify(history),
      'EX',
      FALLBACK_TTL
    );
  } catch {
    // Non-critical
  }
}
