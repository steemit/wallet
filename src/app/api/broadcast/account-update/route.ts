// POST /api/broadcast/account-update
// Broadcast a signed account_update transaction (password / authority change)
import { NextRequest, NextResponse } from 'next/server';
import { steem } from '@steemit/steem-js';
import { SteemService } from '@/lib/steem/server';
import { validateAccountUpdateSignedTx } from '@/lib/steem/validate-account-update-signed-tx';
import { verifyCSRF, rateLimit, setCacheInvalidateHeader } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import type { SignedTransaction } from '@/lib/steem/types';

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { signedTx, username } = (await request.json()) as {
      signedTx: SignedTransaction;
      username: string;
    };

    if (!signedTx || !username) {
      return NextResponse.json(
        { error: 'Missing signed transaction or username' },
        { status: 400 }
      );
    }

    const isValid = SteemService.validateTransactionShape(signedTx);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }

    const txForBroadcast = steem.auth.normalizeTransactionForBroadcast(
      signedTx as unknown as Record<string, unknown>
    ) as unknown as SignedTransaction;

    const shapeError = validateAccountUpdateSignedTx(txForBroadcast);
    if (shapeError) {
      return NextResponse.json(
        { error: 'Invalid account_update transaction', details: shapeError },
        { status: 400 }
      );
    }

    const result = await SteemService.broadcastTransaction(txForBroadcast);

    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix(`cache:query:wallet-estimate-extras:${username}`);

    const response = NextResponse.json({ success: true, result });
    setCacheInvalidateHeader(response, username);
    return response;
  } catch (error) {
    console.error('Broadcast account-update error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
