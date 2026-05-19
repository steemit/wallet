// GET /api/query/withdraw-routes?username=name
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const username = request.nextUrl.searchParams.get('username')?.trim().replace(/^@/, '');
    if (!username) {
      return NextResponse.json({ error: 'Missing username' }, { status: 400 });
    }

    try {
      const result = await withCache(
        `cache:query:withdraw-routes:${username}`,
        60,
        600,
        () => SteemService.getWithdrawRoutesOutgoing(username)
      );

      const response = NextResponse.json({
        success: true,
        routes: result.data,
        ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
      });
      response.headers.set('Cache-Control', 'public, s-maxage=60');
      if (result.degraded) response.headers.set('X-Degraded', 'true');
      return response;
    } catch (error) {
      console.error('withdraw-routes query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch withdraw routes', degraded: true },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('withdraw-routes query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch withdraw routes', details: (error as Error).message },
      { status: 500 }
    );
  }
}
