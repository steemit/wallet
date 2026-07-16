// POST /api/broadcast/vote
// Broadcast a signed vote transaction
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit, setCacheInvalidateHeader } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';
import { validateRelayTransaction } from '@/lib/steem/validate-signed-tx-op';

export async function POST(request: NextRequest) {
  try {
    // Security checks
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 30,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = await request.json();
    const { signedTx, username } = body as { signedTx: SignedTransaction; username: string };

    // Validate input
    if (!signedTx || !username) {
      return NextResponse.json(
        { error: 'Missing signed transaction or username' },
        { status: 400 }
      );
    }

    // Validate transaction: enforce op type AND cryptographically verify the
    // signature belongs to the claimed account (requires @steemit/steem-js >=1.0.20).
    const relayError = await validateRelayTransaction(signedTx, 'vote', username);
    if (relayError) return relayError;


    // Broadcast the transaction
    const result = await SteemService.broadcastTransaction(signedTx);

    // Invalidate Redis caches for this user
    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix(`cache:query:wallet-estimate-extras:${username}`);
    await cacheDeleteByPrefix(`cache:query:withdraw-routes:${username}`);

    const response = NextResponse.json({ success: true, result });
    setCacheInvalidateHeader(response, username);
    return response;
  } catch (error) {
    console.error('Broadcast vote error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
