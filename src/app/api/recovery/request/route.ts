import { NextRequest, NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { verifyCSRF, rateLimit, getClientIP } from '@/lib/middleware';
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

    // Extract client IP for forensics: reuse the proxy-aware getClientIP()
    // (TRUST_PROXY_COUNT-aware) instead of trusting the client-controlled
    // first X-Forwarded-For entry — arecs.remote_ip is the evidence
    // operators rely on when reviewing recovery requests.
    const resolvedIp = getClientIP(request);
    const remoteIp = resolvedIp === 'unknown' ? null : resolvedIp;

    // S6 forensic self-check (2026-09-04 re-verification, residual 1): a real
    // user's recovery request never originates from an internal address. If
    // remote_ip lands in these ranges, the reverse proxy's realip chain
    // failed to resolve the true client (config drift, an untrusted hop, or
    // a direct-to-ALB bypass) and arecs.remote_ip has NO forensic value — it
    // is the infrastructure's own address. Warn so the drift becomes visible
    // in logs; deliberately do NOT block the recovery flow (availability of
    // the recovery path outweighs the evidence loss). Ranges: RFC1918,
    // loopback, IPv6 ULA (fc00::/7), IPv6 link-local (fe80::/10 — never
    // routes to the public internet), and IPv4 link-local (169.254/16 —
    // includes the EC2 instance-metadata address 169.254.169.254). None of
    // these can be a genuine public client, so the check has no
    // false-positive surface.
    const INFRA_IP =
      /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
    if (remoteIp && INFRA_IP.test(remoteIp)) {
      console.warn(
        'recovery/request: remote_ip looks like infrastructure, not a client IP ' +
          '— realip chain may have drifted, arecs.remote_ip has no forensic value',
        { remoteIp }
      );
    }

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
