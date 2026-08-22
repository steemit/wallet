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

  // Strict whitelist for new_owner_authority (S3): this is the ONLY field
  // that decides who owns the account on-chain after recovery, and it is
  // signed on-chain by the server's high-value CONVEYOR key — so it must
  // be exactly the single-key authority derived from new_owner_key.
  // Anything else (extra keys, account_auths delegates, threshold games)
  // is rejected before the state machine is touched.
  // This also closes the DB/chain divergence: the key stored in arecs
  // (new_owner_key) and the key declared on-chain (new_owner_authority)
  // are now required to be the same key.
  const auth = body.new_owner_authority;
  const authValid =
    auth.weight_threshold === 1 &&
    Array.isArray(auth.account_auths) &&
    auth.account_auths.length === 0 &&
    Array.isArray(auth.key_auths) &&
    auth.key_auths.length === 1 &&
    auth.key_auths[0]![0] === body.new_owner_key &&
    auth.key_auths[0]![1] === 1;
  if (!authValid) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid new owner authority' },
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

  // Track whether the CAS claim succeeded so we can roll it back on failure.
  let claimed = false;

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
    claimed = true;

    // Step 1b: Cross-validate old_owner_key against the DB record.
    // This ensures the client-submitted key matches the original request.
    const record = await db.query.arecs.findFirst({
      where: eq(arecs.validationCode, body.code),
      columns: { id: true, ownerKey: true },
    });
    if (!record || (record.ownerKey && record.ownerKey !== body.old_owner_key)) {
      await rollbackToConfirmed(db, body.code, body.account_name);
      return NextResponse.json(
        { status: 'error', error: 'Owner key mismatch' },
        { status: 400 }
      );
    }

    // Step 2: Call kingdom.recovery_account (broadcasts request_account_recovery on-chain).
    const { SteemService } = await import('@/lib/steem/server');

    // Preflight: the recovery-signing key (CONVEYOR_POSTING_WIF) is a
    // high-value secret. If it is missing/misconfigured, surface a clean 503
    // rather than a 500, so the caller can retry once the service is restored.
    const conveyorError = SteemService.validateConveyorConfig();
    if (conveyorError) {
      console.error('Recovery confirm blocked:', conveyorError);
      await rollbackToConfirmed(db, body.code, body.account_name);
      return NextResponse.json(
        { status: 'error', error: 'Recovery service unavailable' },
        { status: 503 }
      );
    }

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
    // Roll back the CAS claim so the user can retry. Without this the record
    // would be stuck in 'processing' forever (no other path resets it), and a
    // single transient RPC error would permanently brick the recovery.
    if (claimed) {
      await rollbackToConfirmed(db, body.code, body.account_name).catch(() => {});
    }
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Revert a recovery record from 'processing' back to 'confirmed' so the user
 * can retry. Best-effort: swallows errors (the response error is already
 * decided by the caller). Only resets records still in 'processing' to avoid
 * clobbering a concurrent success.
 */
async function rollbackToConfirmed(
  db: NonNullable<ReturnType<typeof getDb>>,
  code: string,
  accountName: string
): Promise<void> {
  await db
    .update(arecs)
    .set({ status: 'confirmed' })
    .where(
      and(
        eq(arecs.validationCode, code),
        eq(arecs.accountName, accountName),
        eq(arecs.status, 'processing')
      )
    );
}
