import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';

export async function POST(request: NextRequest) {
  const csrfError = await verifyCSRF(request);
  if (csrfError) return csrfError;

  const rateLimitError = await rateLimit(request, 'recovery_confirm', {
    maxRequests: 5,
    windowSeconds: 300,
  });
  if (rateLimitError) return rateLimitError;

  const body = (await request.json()) as {
    code?: string;
    account_name?: string;
    old_owner_key?: string;
    new_owner_key?: string;
    new_owner_authority?: {
      weight_threshold: number;
      account_auths: [string, number][];
      key_auths: [string, number][];
    };
  };

  if (
    !body.code ||
    !body.account_name ||
    !body.old_owner_key ||
    !body.new_owner_key ||
    !body.new_owner_authority
  ) {
    return NextResponse.json(
      { status: 'error', error: 'Missing fields' },
      { status: 400 }
    );
  }

  // Validate confirmation code format (20 hex chars)
  if (!/^[0-9a-f]{20}$/i.test(body.code)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid confirmation code' },
      { status: 400 }
    );
  }

  // Validate owner key formats
  const stmKeyRegex = /^STM[A-Za-z0-9]{50,}$/;
  if (!stmKeyRegex.test(body.old_owner_key) || !stmKeyRegex.test(body.new_owner_key)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid owner key format' },
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
    // Look up recovery request by validation code
    const arec = await db.query.arecs.findFirst({
      where: eq(arecs.validationCode, body.code),
    });

    if (!arec) {
      return NextResponse.json(
        { status: 'error', error: 'Confirmation code not found' },
        { status: 404 }
      );
    }

    if (arec.status !== 'confirmed') {
      return NextResponse.json(
        { status: 'error', error: 'Recovery request has not been approved' },
        { status: 400 }
      );
    }

    // Verify account name matches
    if (arec.accountName !== body.account_name) {
      return NextResponse.json(
        { status: 'error', error: 'Account name mismatch' },
        { status: 400 }
      );
    }

    // Step 1: Server-side request_account_recovery
    // This broadcasts the request_account_recovery operation signed by the
    // recovery account (e.g. steem). This must be done via Conveyor or a
    // similar service that holds the recovery account's key.
    // TODO: Integrate with Conveyor kingdom.recovery_account when available.
    // For now, this step is expected to be handled externally (turtle admin).

    // Step 2: Update the arecs record
    await db
      .update(arecs)
      .set({
        oldOwnerKey: body.old_owner_key,
        newOwnerKey: body.new_owner_key,
        requestSubmittedAt: new Date(),
        status: 'closed',
      })
      .where(eq(arecs.id, arec.id));

    console.info('Account recovery confirmed:', {
      id: arec.id,
      account_name: body.account_name,
    });

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.error('Recovery confirm failed:', err);
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    );
  }
}
