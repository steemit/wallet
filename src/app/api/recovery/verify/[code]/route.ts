import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';
import {
  isBeyondCodeTtl,
  isStuckProcessingClaim,
  markExpiredIfStale,
  reclaimStuckProcessing,
} from '@/lib/recovery/lifecycle';

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
      columns: { id: true, accountName: true, status: true, updatedAt: true },
    });

    if (!arec) {
      return NextResponse.json(
        { status: 'error', error: 'Confirmation code not found' },
        { status: 404 }
      );
    }

    // Lazy code-TTL enforcement: a confirmed/processing record whose last
    // state change predates the TTL is expired. Persist the terminal status
    // (idempotent CAS — a lost race means someone else already transitioned
    // the row; a DB error is logged but does not change this answer, which
    // is derived from the timestamps, not the write) so admin tooling and
    // later requests see the truth. The write is bounded by the same
    // rate limit as the read.
    if (
      (arec.status === 'confirmed' || arec.status === 'processing') &&
      isBeyondCodeTtl(arec.updatedAt)
    ) {
      await markExpiredIfStale(
        db,
        code,
        arec.accountName,
        arec.status,
        arec.updatedAt
      ).catch((err) => {
        console.error('Recovery verify lazy-expire update failed:', err);
      });
      return NextResponse.json(
        {
          status: 'error',
          error: 'This recovery link has expired.',
          record_status: 'expired',
        },
        { status: 400 }
      );
    }

    // Bounded self-heal for crashed confirm claims: a processing record
    // older than the stuck threshold is a dead claim (the confirm path's
    // conveyor call finishes in minutes). Reclaim it to 'confirmed' so the
    // user is not permanently blocked by a request that crashed mid-flight;
    // the CAS threshold guarantees a live claim is never reclaimed.
    if (arec.status === 'processing' && isStuckProcessingClaim(arec.updatedAt)) {
      try {
        const reclaimAffected = await reclaimStuckProcessing(
          db,
          code,
          arec.accountName,
          arec.updatedAt
        );
        if (reclaimAffected === 1) {
          console.warn(
            'Recovery verify reclaimed a stuck processing record (crashed claim):',
            { code, account_name: arec.accountName, id: arec.id }
          );
          return NextResponse.json({
            status: 'ok',
            account_name: arec.accountName,
            record_status: 'confirmed',
          });
        }
      } catch (err) {
        console.error('Recovery verify stuck-reclaim update failed:', err);
      }
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
