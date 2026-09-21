import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { normalizeAccountForCache } from '@/lib/cache/cache-key';

export async function GET(request: NextRequest) {
  const rateLimitError = await rateLimit(request, 'query', { maxRequests: 30, windowSeconds: 60 });
  if (rateLimitError) return rateLimitError;

  // Normalize so differently-cased spellings hit the same upstream account.
  const username = normalizeAccountForCache(
    new URL(request.url).searchParams.get('username') ?? ''
  );
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
