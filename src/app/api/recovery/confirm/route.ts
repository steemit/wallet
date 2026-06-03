import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
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

  // Validate owner key formats (base58 chars only)
  const stmKeyRegex = /^STM[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50}$/;
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
    // Step 1: Atomically claim the record by setting status to 'processing'.
    // This prevents TOCTOU races — only one request will win the CAS.
    const result = await db
      .update(arecs)
      .set({ status: 'processing' })
      .where(
        and(
          eq(arecs.validationCode, body.code),
          eq(arecs.accountName, body.account_name),
          eq(arecs.status, 'confirmed')
        )
      );

    // Drizzle mysql2 returns { affectedRows: number } for raw updates
    const affected = (result as unknown as { affectedRows?: number }).affectedRows;
    if (!affected || affected === 0) {
      return NextResponse.json(
        { status: 'error', error: 'Recovery request not found or already processed' },
        { status: 400 }
      );
    }

    // Step 1b: Cross-validate old_owner_key against the DB record.
    // This ensures the client-submitted key matches the original request.
    const record = await db.query.arecs.findFirst({
      where: eq(arecs.validationCode, body.code),
      columns: { id: true, ownerKey: true },
    });
    if (!record || (record.ownerKey && record.ownerKey !== body.old_owner_key)) {
      return NextResponse.json(
        { status: 'error', error: 'Owner key mismatch' },
        { status: 400 }
      );
    }

    // Step 2: Call kingdom.recovery_account (broadcasts request_account_recovery on-chain).
    // If this fails, the record stays in 'processing' and won't be re-processed.
    const { SteemService } = await import('@/lib/steem/server');
    await SteemService.requestAccountRecovery({
      account_to_recover: body.account_name,
      new_owner_authority: body.new_owner_authority,
    });

    // Step 3: Mark as closed — success
    await db
      .update(arecs)
      .set({
        oldOwnerKey: body.old_owner_key,
        newOwnerKey: body.new_owner_key,
        requestSubmittedAt: new Date(),
        status: 'closed',
      })
      .where(and(eq(arecs.validationCode, body.code), eq(arecs.accountName, body.account_name)));

    console.info('Account recovery confirmed:', {
      code: body.code,
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
