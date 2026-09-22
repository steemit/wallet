/**
 * Account-recovery record lifecycle helpers (the `arecs` state machine).
 *
 * Recovery is real server-side business (the exception to the relay
 * philosophy), so these transitions are genuine security boundaries:
 *
 * 1. Code TTL — an approved recovery code must not stay usable forever.
 *    wallet-legacy had NO expiry (src/server/api/account_recovery.js looks up
 *    `validation_code` with no time bound; the `expired` status existed in
 *    the vocabulary but was never set by the wallet). We enforce 24h, chosen
 *    because the code is delivered by email and the two-step flow (approve →
 *    user clicks link → confirm + broadcast) is a same-day action; 24h also
 *    matches the conservative end of typical email-link lifetimes.
 *
 * 2. Stuck-`processing` self-heal — the confirm route claims a record with a
 *    `confirmed → processing` CAS and rolls back on every failure path it can
 *    observe, but a crash (process kill, OOM, lost DB connection at the wrong
 *    moment) between claim and rollback leaves the row in `processing`
 *    forever with no other writer to reset it. We bound that window: the
 *    confirm path performs one conveyor signed call (`kingdom.recovery_account`,
 *    a single JSON-RPC request with RPC failover); its realistic upper bound
 *    is a few minutes, so a claim older than 10 minutes is definitively dead
 *    and is CAS-reclaimed back to `confirmed` so the user can retry.
 *
 * Timestamp anchor: `arecs.updated_at` (DATETIME with ON UPDATE
 * CURRENT_TIMESTAMP, bumped by every status transition — including ones made
 * by admin tooling via raw SQL). For a quiescent `confirmed` record it equals
 * the admin-approval time. Each transition (reclaim, re-claim) re-arms both
 * timers, which is intentional: the timers measure inactivity, so a user
 * actively retrying keeps their own window alive while an abandoned code
 * expires. No dedicated `confirmed_at` column is added — that would be a
 * production schema decision (see docs/DATABASE.md drift notes).
 */
import { and, eq, lt } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { mysqlAffectedRows } from '@/lib/db/affected-rows';
import { arecs } from '@/lib/db/schema';

/** How long an approved (or in-flight) recovery code stays usable. */
export const RECOVERY_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a `processing` claim may run before it is considered a crashed
 * claim and becomes reclaimable. Comfortably above the confirm path's
 * realistic maximum (one conveyor call + failover), far below user patience.
 */
export const PROCESSING_STUCK_MS = 10 * 60 * 1000;

type Db = NonNullable<ReturnType<typeof getDb>>;

/** Coerce a drizzle datetime value (Date or string) to epoch millis. */
export function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' && value) {
    const ms = new Date(value.endsWith('Z') ? value : `${value}Z`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Whether a confirmed/processing record has outlived the code TTL and must
 * be treated as (and transitioned to) `expired`. Unknown timestamps are never
 * stale — fail-open on a missing column value keeps legacy rows usable.
 */
export function isBeyondCodeTtl(
  updatedAt: Date | string | null | undefined,
  now: number = Date.now()
): boolean {
  const updatedMs = toEpochMs(updatedAt);
  return updatedMs !== null && updatedMs < now - RECOVERY_CODE_TTL_MS;
}

/**
 * Whether a `processing` record's claim is old enough to be a crashed claim
 * (safe to reclaim). Unknown timestamps are never stuck — an in-flight claim
 * must never be reclaimed from under a live request.
 */
export function isStuckProcessingClaim(
  updatedAt: Date | string | null | undefined,
  now: number = Date.now()
): boolean {
  const updatedMs = toEpochMs(updatedAt);
  return updatedMs !== null && updatedMs < now - PROCESSING_STUCK_MS;
}

/**
 * Atomically transition a stale confirmed/processing record to the terminal
 * `expired` state. The CAS conditions (expected status + the same stale
 * cutoff that was used to decide) make it race-safe: 0 affected rows means
 * another request already moved the row on. Best-effort by design — the
 * caller has already decided the record is expired; this only persists that
 * decision for admin tooling and later requests.
 *
 * Returns the affected-rows count, or undefined for an unreadable result
 * shape (see mysqlAffectedRows).
 */
export async function markExpiredIfStale(
  db: Db,
  code: string,
  accountName: string,
  expectedStatus: string,
  updatedAt: Date | string | null | undefined,
  now: number = Date.now()
): Promise<number | undefined> {
  const updatedMs = toEpochMs(updatedAt);
  if (updatedMs === null) return 0;
  const staleBefore = new Date(now - RECOVERY_CODE_TTL_MS);
  const result = await db
    .update(arecs)
    .set({ status: 'expired' })
    .where(
      and(
        eq(arecs.validationCode, code),
        eq(arecs.accountName, accountName),
        eq(arecs.status, expectedStatus),
        lt(arecs.updatedAt, staleBefore)
      )
    );
  return mysqlAffectedRows(result);
}

/**
 * Atomically reclaim a crashed `processing` claim back to `confirmed` so the
 * user can retry. Bounded by the stuck threshold via the same CAS discipline:
 * a concurrent live claim (fresh updated_at) is never touched, and 0 affected
 * rows means another request won the reclaim. The UPDATE bumps updated_at,
 * which re-arms both the stuck and TTL timers — intentional (see header).
 *
 * Returns the affected-rows count, or undefined for an unreadable result
 * shape.
 */
export async function reclaimStuckProcessing(
  db: Db,
  code: string,
  accountName: string,
  updatedAt: Date | string | null | undefined,
  now: number = Date.now()
): Promise<number | undefined> {
  const updatedMs = toEpochMs(updatedAt);
  if (updatedMs === null) return 0;
  const stuckBefore = new Date(now - PROCESSING_STUCK_MS);
  const result = await db
    .update(arecs)
    .set({ status: 'confirmed' })
    .where(
      and(
        eq(arecs.validationCode, code),
        eq(arecs.accountName, accountName),
        eq(arecs.status, 'processing'),
        lt(arecs.updatedAt, stuckBefore)
      )
    );
  return mysqlAffectedRows(result);
}
