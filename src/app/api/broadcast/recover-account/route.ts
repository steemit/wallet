// POST /api/broadcast/recover-account
// Broadcast a signed recover_account transaction (step 2 of account recovery)
import { NextRequest, NextResponse } from 'next/server';
import { steem } from '@steemit/steem-js';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import type { SignedTransaction } from '@/lib/steem/types';

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 3,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { signedTx } = (await request.json()) as {
      signedTx: SignedTransaction;
    };

    if (!signedTx) {
      return NextResponse.json(
        { error: 'Missing signed transaction' },
        { status: 400 }
      );
    }

    const isValid = await SteemService.verifySignature(signedTx);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }

    const op0 = signedTx.operations?.[0];
    if (!Array.isArray(op0) || op0[0] !== 'recover_account') {
      return NextResponse.json(
        { error: 'Invalid transaction: expected recover_account operation' },
        { status: 400 }
      );
    }

    const txForBroadcast = steem.auth.normalizeTransactionForBroadcast(
      signedTx as unknown as Record<string, unknown>
    ) as unknown as SignedTransaction;

    const result = await SteemService.broadcastTransaction(txForBroadcast);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Broadcast recover-account error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to broadcast transaction',
        details: message,
      },
      { status: 500 }
    );
  }
}
