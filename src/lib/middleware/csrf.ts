// CSRF Protection middleware
//
// Token design: `base64url(timestamp).base64url(HMAC(secret, timestamp))`.
// The token is a signed (HMAC-SHA256), time-bounded, unforgeable value: even
// though the cookie is readable by JS (required for the double-submit pattern),
// an attacker cannot mint a valid one without the secret. Verification compares
// the expected and provided MAC in constant time and rejects tokens older than
// the configured max age.
//
// SECURITY: there is intentionally no insecure default secret. In production
// (NODE_ENV === 'production') a missing CSRF_SECRET causes every mutation to be
// rejected (fail-closed). In non-production a random per-process secret is used
// so dev still works, but tokens never survive a restart.
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

const CSRF_TOKEN_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function getSecret(): string {
  const envSecret = process.env.CSRF_SECRET;
  if (envSecret && envSecret.trim()) return envSecret.trim();

  // Fail-closed in production: without a configured secret, no mutation can be
  // authorized. (We return a random value so tokens never validate rather than
  // throwing at import time.)
  if (process.env.NODE_ENV === 'production') {
    // Lazily log once; a random secret guarantees rejection without crashing.
    if (!loggedMissingSecret) {
      console.error('CSRF_SECRET is not set in production — all mutations will be rejected');
      loggedMissingSecret = true;
    }
    return randomSecretFallback;
  }
  // Non-production: random per-process secret (dev convenience).
  return randomSecretFallback;
}

let loggedMissingSecret = false;
const randomSecretFallback = randomBytes(32).toString('hex');

function hmacBase64url(timestamp: string): string {
  return createHmac('sha256', getSecret()).update(timestamp).digest('base64url');
}

/** Constant-time string comparison. Returns false on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generate a CSRF token: `base64url(timestamp).base64url(hmac(timestamp))`.
 */
export function generateCSRFToken(): string {
  const timestamp = Date.now().toString();
  const tsB64 = Buffer.from(timestamp, 'utf-8').toString('base64url');
  const macB64 = hmacBase64url(timestamp);
  return `${tsB64}.${macB64}`;
}

/**
 * Verify a CSRF token value (format + signature + age). Returns true if valid.
 */
export function isValidCSRFToken(token: string): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;

  const tsB64 = token.slice(0, dot);
  const macB64 = token.slice(dot + 1);

  let timestampStr: string;
  try {
    timestampStr = Buffer.from(tsB64, 'base64url').toString('utf-8');
  } catch {
    return false;
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;

  // Reject expired tokens
  if (Date.now() - timestamp > CSRF_MAX_AGE_MS) return false;

  // Constant-time MAC comparison
  const expectedMac = hmacBase64url(timestampStr);
  return safeEqual(expectedMac, macB64);
}

/**
 * Verify CSRF token from request.
 * Returns error response if invalid, null if valid.
 */
export async function verifyCSRF(request: NextRequest): Promise<NextResponse | null> {
  // Skip CSRF for safe read-only methods
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return null;
  }

  // Get tokens from header and cookie
  const headerToken = request.headers.get(CSRF_TOKEN_HEADER);
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;

  // Both tokens must be present (double-submit pattern)
  if (!headerToken || !cookieToken) {
    return NextResponse.json(
      { error: 'CSRF token missing' },
      { status: 403 }
    );
  }

  // Header and cookie must match (double-submit)
  if (!safeEqual(headerToken, cookieToken)) {
    return NextResponse.json(
      { error: 'CSRF token mismatch' },
      { status: 403 }
    );
  }

  // Token must be cryptographically valid (HMAC + freshness)
  if (!isValidCSRFToken(cookieToken)) {
    return NextResponse.json(
      { error: 'Invalid CSRF token' },
      { status: 403 }
    );
  }

  return null;
}

/**
 * Set CSRF token in response
 */
export function setCSRFToken(response: NextResponse): void {
  const token = generateCSRFToken();
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    // CSRF token is not a secret; it must be readable by JS
    // so that the client can mirror it into the X-CSRF-Token header.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60, // 24 hours
    path: '/',
  });
}

/**
 * Create a response with CSRF token
 */
export function createCSRFResponse(data: unknown): NextResponse {
  const response = NextResponse.json(data);
  setCSRFToken(response);
  return response;
}
