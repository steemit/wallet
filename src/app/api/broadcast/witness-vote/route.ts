// POST /api/broadcast/witness-vote
// Broadcast a signed witness vote transaction
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';
import { logBroadcastFailure, logBroadcastSuccess } from '@/lib/steem/broadcast-audit';

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

    logBroadcastSuccess('witness-vote', signedTx, username, result);

    // Witness votes change the account object and the witness list (600s TTL
    // cache) — not the wallet-estimate extras or withdraw routes (those
    // deletes were copy-paste drift from the transfer route).
    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix('cache:query:witnesses');

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logBroadcastFailure('witness-vote', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
