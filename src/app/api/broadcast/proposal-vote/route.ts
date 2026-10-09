// POST /api/broadcast/proposal-vote
// Broadcast a signed proposal vote transaction (update_proposal_votes)
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

    const rateLimitError = await rateLimit(request, 'broadcast', { maxRequests: 10, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    const body = await request.json();
    const { signedTx, username } = body as { signedTx: SignedTransaction; username: string };

    if (!signedTx || !username) {
      return NextResponse.json({ error: 'Missing signed transaction or username' }, { status: 400 });
    }

    // Pure relay: no content verification — the chain validates signatures/authorities.
    // Shape check only rejects obvious garbage before spending an upstream RPC call.
    if (!SteemService.validateTransactionShape(signedTx)) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }


    const result = await SteemService.broadcastTransaction(signedTx);

    logBroadcastSuccess('proposal-vote', signedTx, username, result);

    // Voting changes the proposals list (upVoted flags / vote counts), not
    // wallet data — the extras delete was copy-paste drift.
    await cacheDeleteByPrefix('cache:query:proposals');

    return NextResponse.json({ success: true, result });
  } catch (error) {
    logBroadcastFailure('proposal-vote', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}

