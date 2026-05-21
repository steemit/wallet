// GET /api/query/global-props
// Get Steem global properties
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { applyRpcOverride } from '@/lib/api/with-rpc-override';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const result = await applyRpcOverride(request, () =>
      withCache('cache:query:global-props', 3, 300, () => SteemService.getGlobalProperties())
    );

    const response = NextResponse.json({
      success: true,
      props: result.data,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=3');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching global properties:', error);
    return NextResponse.json(
      { error: 'Failed to fetch global properties', degraded: true },
      { status: 503 }
    );
  }
}
