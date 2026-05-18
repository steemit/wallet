// GET /api/query/history?username=user&limit=100
// Get account transaction history
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

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

    const history = await SteemService.getAccountHistory(username, limit);

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history', details: (error as Error).message },
      { status: 500 }
    );
  }
}
