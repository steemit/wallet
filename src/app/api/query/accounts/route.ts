// GET /api/query/accounts?names=user1,user2
// Get account information
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 100,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const namesParam = searchParams.get('names');

    if (!namesParam) {
      return NextResponse.json(
        { error: 'Missing names parameter' },
        { status: 400 }
      );
    }

    const usernames = namesParam.split(',').map((s) => s.trim()).filter(Boolean);

    if (usernames.length === 0) {
      return NextResponse.json(
        { error: 'No usernames provided' },
        { status: 400 }
      );
    }

    if (usernames.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 accounts per request' },
        { status: 400 }
      );
    }

    const accounts = await SteemService.getAccounts(usernames);

    const response = NextResponse.json({ success: true, accounts });
    response.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return response;
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accounts', details: (error as Error).message },
      { status: 500 }
    );
  }
}
