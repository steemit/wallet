// GET /api/query/transaction-header
// Ref block + expiration for client-side transaction signing (matches steem-js broadcast prep).
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { rateLimit } from '@/lib/middleware';
import { applyRpcOverride } from '@/lib/api/with-rpc-override';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', {
      maxRequests: 120,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const header = await applyRpcOverride(request, () => SteemService.prepareTransactionHeader());
    const response = NextResponse.json({ success: true, ...header });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('Error fetching transaction header:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch transaction header' },
      { status: 503 }
    );
  }
}
