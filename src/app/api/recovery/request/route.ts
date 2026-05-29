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

  // Normalize and validate account_name (Steem account rules: lowercase, 3-16 chars, starts with letter)
  const accountName = body.account_name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(accountName)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid account name format' },
      { status: 400 }
    );
  }

  // Normalize email (lowercase + trim) to prevent duplicate bypass
  const contactEmail = body.contact_email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json(
      { status: 'error', error: 'Invalid email format' },
      { status: 400 }
    );
  }

  // Validate owner_key format: must be a Steem public key (STM + base58, 53 chars)
  if (!/^STM[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50}$/.test(body.owner_key)) {
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
        eq(arecs.accountName, accountName),
        eq(arecs.contactEmail, contactEmail),
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
      contactEmail,
      accountName,
      ownerKey: body.owner_key,
      provider: 'email',
      remoteIp,
      status: 'open',
    });

    console.info('Recovery request created:', {
      account_name: accountName,
      contact_email: contactEmail,
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
