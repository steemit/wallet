// GET /api/query/withdraw-routes?username=name
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

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

    const routes = await SteemService.getWithdrawRoutesOutgoing(username);

    const response = NextResponse.json({
      success: true,
      routes,
    });
    response.headers.set('Cache-Control', 'public, s-maxage=60');
    return response;
  } catch (error) {
    console.error('withdraw-routes query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch withdraw routes', details: (error as Error).message },
      { status: 500 }
    );
  }
}
