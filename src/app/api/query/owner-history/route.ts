import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  const rateLimitError = await rateLimit(request, 'query', { maxRequests: 30, windowSeconds: 60 });
  if (rateLimitError) return rateLimitError;

  const username = new URL(request.url).searchParams.get('username')?.trim().toLowerCase();
  if (!username) {
    return NextResponse.json({ error: 'username required' }, { status: 400 });
  }

  try {
    const history = await SteemService.getOwnerHistory(username);
    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error('owner-history error:', error);
    return NextResponse.json({ error: 'Failed to fetch owner history' }, { status: 503 });
  }
}
