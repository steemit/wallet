import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  // Rate limit: a valid code confirms an account name, so this endpoint is a
  // (low-severity) enumeration surface — mitigated by the 80-bit admin-generated
  // code, but kept modest to further limit guessing.
  const rateLimitError = await rateLimit(request, 'recovery_verify', {
    maxRequests: 10,
    windowSeconds: 300,
  });
  if (rateLimitError) return rateLimitError;

  const { code } = await params;

  if (!code || !/^[0-9a-f]{20}$/i.test(code)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid confirmation code' },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { status: 'error', error: 'Service unavailable' },
      { status: 503 }
    );
  }

  try {
    const arec = await db.query.arecs.findFirst({
      where: eq(arecs.validationCode, code),
      columns: { id: true, accountName: true, status: true },
    });

    if (!arec) {
      return NextResponse.json(
        { status: 'error', error: 'Confirmation code not found' },
        { status: 404 }
      );
    }

    // State-accurate responses: the step-2 page maps `record_status` to a
    // localized message and decides which mode to render. `confirmed` is the
    // normal flow; `closed` means confirm already succeeded on-chain
    // (request_account_recovery submitted) and only the final recover_account
    // broadcast may still be pending — the page offers a retry-broadcast
    // mode for that state instead of a misleading "not approved" error.
    switch (arec.status) {
      case 'confirmed':
      case 'closed':
        return NextResponse.json({
          status: 'ok',
          account_name: arec.accountName,
          record_status: arec.status,
        });
      case 'open':
        return NextResponse.json(
          {
            status: 'error',
            error: 'Recovery request has not been approved yet',
            record_status: 'open',
          },
          { status: 400 }
        );
      case 'processing':
        return NextResponse.json(
          {
            status: 'error',
            error: 'Recovery request is currently being processed. Please try again in a few minutes.',
            record_status: 'processing',
          },
          { status: 400 }
        );
      case 'expired':
        return NextResponse.json(
          {
            status: 'error',
            error: 'This recovery link has expired.',
            record_status: 'expired',
          },
          { status: 400 }
        );
      case 'consumed':
        return NextResponse.json(
          {
            status: 'error',
            error: 'This recovery link has already been used to complete the account recovery.',
            record_status: 'consumed',
          },
          { status: 400 }
        );
      default:
        return NextResponse.json(
          {
            status: 'error',
            error: 'Recovery request is not available.',
            record_status: arec.status,
          },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error('Recovery verify failed:', err);
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    );
  }
}
