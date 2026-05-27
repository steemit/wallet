import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', { maxRequests: 5, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    const body = await request.json();
    const { signedTx, username } = body as { signedTx: SignedTransaction; username: string };

    if (!signedTx || !username) {
      return NextResponse.json({ error: 'Missing signed transaction or username' }, { status: 400 });
    }

    const isValid = await SteemService.verifySignature(signedTx);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }

    const result = await SteemService.broadcastTransaction(signedTx);

    await cacheDeleteByPrefix('cache:query:proposals');

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Broadcast proposal remove error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction', details: (error as Error).message },
      { status: 500 }
    );
  }
}
