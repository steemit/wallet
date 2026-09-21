// POST /api/broadcast/set-withdraw-vesting-route
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { cacheDeleteByPrefix } from '@/lib/cache/redis';
import { hashedUserCachePrefix } from '@/lib/cache/cache-key';
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

    // This op IS the withdraw-routes data source; the account object also
    // carries the route. Hashed prefix — see transfer route.
    await cacheDeleteByPrefix('cache:query:accounts');
    await cacheDeleteByPrefix(hashedUserCachePrefix('cache:query:withdraw-routes', username));

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Broadcast set-withdraw-vesting-route error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
