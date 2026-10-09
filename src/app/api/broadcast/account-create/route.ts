// POST /api/broadcast/account-create
// Broadcast a signed account_create transaction (community creation step 1)
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';
import { logBroadcastFailure, logBroadcastSuccess } from '@/lib/steem/broadcast-audit';

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 10,
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

    // Pure relay: no content verification — the chain validates signatures/authorities.
    // Shape check only rejects obvious garbage before spending an upstream RPC call.
    if (!SteemService.validateTransactionShape(signedTx)) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }


    const result = await SteemService.broadcastTransaction(signedTx);

    logBroadcastSuccess('account-create', signedTx, username, result);

    await cacheDeleteByPrefix('cache:query:accounts');

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logBroadcastFailure('account-create', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
