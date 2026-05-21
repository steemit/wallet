// GET /api/query/witnesses?limit=100
// Get witnesses list
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

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    if (limit < 1 || limit > 500) {
      return NextResponse.json(
        { error: 'Limit must be between 1 and 500' },
        { status: 400 }
      );
    }

    try {
      const result = await applyRpcOverride(request, () =>
        withCache(`cache:query:witnesses:${limit}`, 600, 1800, () =>
          SteemService.getWitnessesByVote(limit)
        )
      );

      const response = NextResponse.json({
        success: true,
        witnesses: result.data,
        ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
      });
      response.headers.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      if (result.degraded) response.headers.set('X-Degraded', 'true');
      return response;
    } catch (error) {
      console.error('Error fetching witnesses:', error);
      return NextResponse.json(
        { error: 'Failed to fetch witnesses', degraded: true },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('Error fetching witnesses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch witnesses', details: (error as Error).message },
      { status: 500 }
    );
  }
}
