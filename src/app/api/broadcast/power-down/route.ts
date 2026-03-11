// POST /api/broadcast/power-down
// Broadcast a signed power down transaction
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import type { SignedTransaction } from '@/lib/steem/types';

export async function POST(request: NextRequest) {
  try {
    // Security checks
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 5,
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

    // Verify transaction format
    const isValid = await SteemService.verifySignature(signedTx);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid transaction format' },
        { status: 400 }
      );
    }

    // Broadcast the transaction
    const result = await SteemService.broadcastTransaction(signedTx);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('Broadcast power down error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction', details: (error as Error).message },
      { status: 500 }
    );
  }
}
