import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';

export async function POST(request: NextRequest) {
  const csrfError = await verifyCSRF(request);
  if (csrfError) return csrfError;

  const rateLimitError = await rateLimit(request, 'recovery', { maxRequests: 5, windowSeconds: 300 });
  if (rateLimitError) return rateLimitError;

  const body = (await request.json()) as {
    contact_email?: string;
    account_name?: string;
    owner_key?: string;
  };

  if (!body.contact_email || !body.account_name || !body.owner_key) {
    return NextResponse.json({ status: 'error', error: 'Missing fields' }, { status: 400 });
  }

  // Validate owner_key format: must be a Steem public key (STM + base58, ~53 chars)
  if (!/^STM[A-Za-z0-9]{50,}$/.test(body.owner_key)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid owner key format' },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    console.error('Database unavailable for recovery request');
    return NextResponse.json(
      { status: 'error', error: 'Service unavailable' },
      { status: 503 }
    );
  }

  try {
    // Check for duplicate (same account_name + contact_email, status='open')
    const existing = await db.query.arecs.findFirst({
      where: and(
        eq(arecs.accountName, body.account_name),
        eq(arecs.contactEmail, body.contact_email),
        eq(arecs.status, 'open')
      ),
    });

    if (existing) {
      return NextResponse.json({ status: 'duplicate' });
    }

    // Extract client IP
    const remoteIp =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    // Insert new recovery request
    await db.insert(arecs).values({
      uid: null, // not available without login session
      contactEmail: body.contact_email,
      accountName: body.account_name,
      ownerKey: body.owner_key,
      provider: 'email',
      remoteIp,
      status: 'open',
    });

    console.info('Recovery request created:', {
      account_name: body.account_name,
      contact_email: body.contact_email,
    });

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.error('Recovery request failed:', err);
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    );
  }
}
