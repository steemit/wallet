// GET /api/query/witnesses?limit=100
// Get witnesses list
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

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

    const witnesses = await SteemService.getWitnessesByVote(limit);

    return NextResponse.json({
      success: true,
      witnesses,
    });
  } catch (error) {
    console.error('Error fetching witnesses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch witnesses', details: (error as Error).message },
      { status: 500 }
    );
  }
}
