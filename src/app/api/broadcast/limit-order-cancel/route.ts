// POST /api/broadcast/limit-order-cancel
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit, setCacheInvalidateHeader } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';
import { validateRelayTransaction } from '@/lib/steem/validate-signed-tx-op';

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 20,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const body = await request.json();
    const { signedTx, username } = body as { signedTx: SignedTransaction; username: string };

    if (!signedTx || !username) {
      return NextResponse.json(
        { error: 'Missing signed transaction or username' },
        { status: 400 }
      );
    }

    // Validate transaction: enforce op type AND cryptographically verify the
    // signature belongs to the claimed account (requires @steemit/steem-js >=1.0.20).
    const relayError = await validateRelayTransaction(signedTx, 'limit_order_cancel', username);
    if (relayError) return relayError;


    const result = await SteemService.broadcastTransaction(signedTx);

    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix(`cache:query:wallet-estimate-extras:${username}`);
    await cacheDeleteByPrefix(`cache:query:market`);

    const response = NextResponse.json({ success: true, result });
    setCacheInvalidateHeader(response, username);
    return response;
  } catch (error) {
    console.error('Broadcast limit_order_cancel error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
