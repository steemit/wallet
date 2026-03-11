// GET /api/query/global-props
// Get Steem global properties
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 60,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const props = await SteemService.getGlobalProperties();

    return NextResponse.json({
      success: true,
      props,
    });
  } catch (error) {
    console.error('Error fetching global properties:', error);
    return NextResponse.json(
      { error: 'Failed to fetch global properties', details: (error as Error).message },
      { status: 500 }
    );
  }
}
