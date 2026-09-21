// POST /api/broadcast/cancel-transfer-from-savings
// Broadcast a signed cancel_transfer_from_savings transaction (active authority).
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import { hashedUserCachePrefix } from '@/lib/cache/cache-key';
import type { SignedTransaction } from '@/lib/steem/types';

export async function POST(request: NextRequest) {
  try {
    // Security checks
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 10,
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

    // Pure relay: no content verification — the chain validates signatures/authorities.
    // Shape check only rejects obvious garbage before spending an upstream RPC call.
    if (!SteemService.validateTransactionShape(signedTx)) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }

    // Broadcast the transaction
    const result = await SteemService.broadcastTransaction(signedTx);

    // Cancelling a pending savings withdrawal changes balances and the
    // extras savings-withdrawals list. Hashed prefix — see transfer route.
    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix(hashedUserCachePrefix('cache:query:wallet-estimate-extras', username));

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Broadcast cancel_transfer_from_savings error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
