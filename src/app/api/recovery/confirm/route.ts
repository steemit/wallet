import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gte } from 'drizzle-orm';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { mysqlAffectedRows } from '@/lib/db/affected-rows';
import { arecs } from '@/lib/db/schema';
import {
  RECOVERY_CODE_TTL_MS,
  isBeyondCodeTtl,
  isStuckProcessingClaim,
  markExpiredIfStale,
  reclaimStuckProcessing,
} from '@/lib/recovery/lifecycle';

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
  //
  // The inner key_auths entry must be a real 2-tuple (Array.isArray). An
  // object-map `{0: STM…, 1: 1}` satisfies JS index reads but is dropped by
  // steem-js authorityMapEntries, which would let a malformed payload past
  // this gate and into the CONVEYOR signing call.
  const auth = body.new_owner_authority;
  const firstKeyAuth = auth.key_auths?.[0];
  const authValid =
    auth.weight_threshold === 1 &&
    Array.isArray(auth.account_auths) &&
    auth.account_auths.length === 0 &&
    Array.isArray(auth.key_auths) &&
    auth.key_auths.length === 1 &&
    Array.isArray(firstKeyAuth) &&
    firstKeyAuth.length === 2 &&
    firstKeyAuth[0] === body.new_owner_key &&
    firstKeyAuth[1] === 1;
  if (!authValid) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid new owner authority' },
      { status: 400 }
    );
  }

  // Never forward the client object. Extra enumerable fields or serializer
  // quirks must not reach kingdom / the chain; the CONVEYOR key only ever
  // signs this canonical single-key authority.
  const newOwnerAuthority = {
    weight_threshold: 1,
    account_auths: [] as [string, number][],
    key_auths: [[body.new_owner_key, 1]] as [string, number][],
  };

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
    // The claim is TTL-bounded (updated_at within the code TTL): a code
    // approved longer than RECOVERY_CODE_TTL_MS ago can no longer be claimed,
    // so stale codes die here even before the lazy expiry below runs.
    const result = await claimConfirmed(db, body.code, body.account_name);

    // Drizzle mysql2 update (no .returning()) resolves to the raw mysql2
    // tuple [ResultSetHeader, FieldPacket[]]; the header is at index 0.
    const affected = mysqlAffectedRows(result);
    if (affected === undefined) {
      // Unreadable result shape: the row MAY have been claimed above. Roll
      // back any claim (rollback only touches rows still in 'processing')
      // and fail loudly instead of silently sticking the record.
      // Log the account and the raw shape (a ResultSetHeader carries no
      // secrets) so the failure is diagnosable from server logs.
      console.error(
        'Recovery confirm CAS update returned an unreadable result shape; failing closed:',
        { account_name: body.account_name, result }
      );
      await rollbackToConfirmed(db, body.code, body.account_name).catch((rollbackErr) => {
        // The row may now be stuck in 'processing' (no other path resets
        // it) — that must be visible in logs, not silently swallowed.
        console.error(
          'Recovery confirm rollback to confirmed also failed; record may be stuck in processing:',
          { account_name: body.account_name, error: rollbackErr }
        );
      });
      return NextResponse.json(
        { status: 'error', error: 'Internal server error' },
        { status: 500 }
      );
    }
    if (affected === 0) {
      // Not claimable as-is. Diagnose the miss: lazily expire stale codes,
      // un-stick crashed processing claims (bounded self-heal), or return a
      // state-accurate error. If the diagnosis reclaimed and re-claimed the
      // row, fall through and run the normal flow.
      const outcome = await diagnoseClaimMiss(db, body.code, body.account_name);
      if (outcome.response) return outcome.response;
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
      new_owner_authority: newOwnerAuthority,
    });

    // Step 3: Mark as closed — success. The WHERE pins status='processing'
    // (i.e. OUR claim): a zombie confirm must never overwrite a row that a
    // later confirm (via the stuck-claim reclaim) already closed, or that
    // the recover-account consume CAS already flipped to 'consumed'.
    const closeResult = await db
      .update(arecs)
      .set({
        oldOwnerKey: body.old_owner_key,
        newOwnerKey: body.new_owner_key,
        requestSubmittedAt: new Date(),
        status: 'closed',
      })
      .where(
        and(
          eq(arecs.validationCode, body.code),
          eq(arecs.accountName, body.account_name),
          eq(arecs.status, 'processing')
        )
      );
    const closeAffected = mysqlAffectedRows(closeResult);
    if (closeAffected === 0) {
      // Lost race: another request moved the row out of 'processing'
      // between our claim and this write. Do not report success, and do
      // NOT roll back — the row is no longer ours, and a rollback could
      // reset a NEW live claim held by the request that progressed it.
      // Same 400 family the route uses for claim misses (genericMiss).
      console.warn('Recovery confirm lost the close race (row already progressed):', {
        code: body.code,
        account_name: body.account_name,
      });
      return NextResponse.json(
        { status: 'error', error: 'Recovery request not found or already processed' },
        { status: 400 }
      );
    }
    if (closeAffected === undefined) {
      // Unreadable result shape (driver contract drift): fail loudly like
      // the claim CAS. No rollback here: the broadcast already succeeded
      // and the row state is unknown — a row left in 'processing' by this
      // path is reclaimed by the bounded stuck-claim self-heal.
      console.error(
        'Recovery confirm close update returned an unreadable result shape; failing closed:',
        { account_name: body.account_name }
      );
      return NextResponse.json(
        { status: 'error', error: 'Internal server error' },
        { status: 500 }
      );
    }

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
 * The confirmed → processing CAS claim. TTL-bounded: the record's last state
 * change must be within RECOVERY_CODE_TTL_MS, so a stale confirmed record is
 * not claimable (it is expired by diagnoseClaimMiss instead).
 */
function claimConfirmed(
  db: NonNullable<ReturnType<typeof getDb>>,
  code: string,
  accountName: string
) {
  return db
    .update(arecs)
    .set({ status: 'processing' })
    .where(
      and(
        eq(arecs.validationCode, code),
        eq(arecs.accountName, accountName),
        eq(arecs.status, 'confirmed'),
        gte(arecs.updatedAt, new Date(Date.now() - RECOVERY_CODE_TTL_MS))
      )
    );
}

/**
 * Diagnose a missed claim (affected === 0) and self-heal where bounded:
 *
 * - confirmed/processing beyond the code TTL → lazily persist the terminal
 *   `expired` status and reject with a state-accurate error (machine-readable
 *   record_status so the frontend renders localized copy);
 * - processing beyond the stuck threshold → a crashed claim: CAS it back to
 *   `confirmed` and retry the claim once, so one dead request cannot brick
 *   the recovery forever;
 * - anything else (open/closed/consumed, live processing, wrong account)
 *   → state-accurate error without touching the row.
 *
 * Returns `{ reclaimed: true }` when the stuck-claim reclaim succeeded AND
 * the retried claim won (the caller continues the normal flow, with `claimed`
 * semantics intact), otherwise `{ response }` with the error to return.
 */
async function diagnoseClaimMiss(
  db: NonNullable<ReturnType<typeof getDb>>,
  code: string,
  accountName: string
): Promise<{ response?: NextResponse; reclaimed?: boolean }> {
  const record = await db.query.arecs.findFirst({
    where: eq(arecs.validationCode, code),
    columns: { id: true, status: true, updatedAt: true },
  });

  const genericMiss = () =>
    NextResponse.json(
      { status: 'error', error: 'Recovery request not found or already processed' },
      { status: 400 }
    );
  const expiredResponse = () =>
    NextResponse.json(
      {
        status: 'error',
        error: 'This recovery link has expired. Please submit a new recovery request.',
        record_status: 'expired',
      },
      { status: 400 }
    );
  const processingResponse = () =>
    NextResponse.json(
      {
        status: 'error',
        error:
          'Recovery request is currently being processed. Please try again in a few minutes.',
        record_status: 'processing',
      },
      { status: 400 }
    );

  if (!record) return { response: genericMiss() };

  if (record.status === 'confirmed' || record.status === 'processing') {
    // Code TTL: a record whose last state change predates the TTL is dead.
    // Persist the terminal status (best-effort CAS; a lost race simply means
    // another request already transitioned the row) and reject.
    if (isBeyondCodeTtl(record.updatedAt)) {
      await markExpiredIfStale(
        db,
        code,
        accountName,
        record.status,
        record.updatedAt
      ).catch((err) => {
        console.error('Recovery confirm lazy-expire update failed:', err);
      });
      return { response: expiredResponse() };
    }

    if (record.status === 'processing') {
      // Bounded self-heal for crashed claims: a processing row older than
      // the stuck threshold cannot be a live request anymore.
      if (isStuckProcessingClaim(record.updatedAt)) {
        const reclaimAffected = await reclaimStuckProcessing(
          db,
          code,
          accountName,
          record.updatedAt
        );
        if (reclaimAffected === 1) {
          // Reclaim won: retry the claim once under the same CAS discipline.
          const retryAffected = mysqlAffectedRows(
            await claimConfirmed(db, code, accountName)
          );
          if (retryAffected === 1) {
            console.warn(
              'Recovery confirm reclaimed a stuck processing record (crashed claim):',
              { code, account_name: accountName, id: record.id }
            );
            return { reclaimed: true };
          }
          if (retryAffected === undefined) {
            // Unreadable retry result: the row may be claimed by us. Roll
            // back best-effort and fail loudly; if the rollback misses, the
            // stuck-reclaim path will un-stick it on a later request.
            console.error(
              'Recovery confirm retry claim returned an unreadable result shape; failing closed:',
              { account_name: accountName }
            );
            await rollbackToConfirmed(db, code, accountName).catch(() => {});
            return {
              response: NextResponse.json(
                { status: 'error', error: 'Internal server error' },
                { status: 500 }
              ),
            };
          }
          // Lost the re-claim race (another request is proceeding).
          return { response: processingResponse() };
        }
        if (reclaimAffected === undefined) {
          console.error(
            'Recovery confirm stuck-reclaim update returned an unreadable result shape:',
            { account_name: accountName }
          );
        }
        // 0 (lost the reclaim race) or unreadable: treat as in-progress.
        return { response: processingResponse() };
      }
      // Live claim by another request.
      return { response: processingResponse() };
    }
  }

  if (record.status === 'expired') return { response: expiredResponse() };
  return { response: genericMiss() };
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
