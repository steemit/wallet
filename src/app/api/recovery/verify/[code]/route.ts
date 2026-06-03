import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const rateLimitError = await rateLimit(request, 'recovery_verify', {
    maxRequests: 20,
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

    if (arec.status !== 'confirmed') {
      return NextResponse.json(
        { status: 'error', error: 'Recovery request has not been approved yet' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      status: 'ok',
      account_name: arec.accountName,
    });
  } catch (err) {
    console.error('Recovery verify failed:', err);
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    );
  }
}
