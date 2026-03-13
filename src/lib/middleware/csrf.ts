// CSRF Protection middleware
import { NextRequest, NextResponse } from 'next/server';

const CSRF_SECRET = process.env.CSRF_SECRET || 'default-csrf-secret-change-in-production';
const CSRF_TOKEN_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE_NAME = 'csrf_token';

/**
 * Generate a CSRF token
 */
export function generateCSRFToken(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const token = Buffer.from(`${CSRF_SECRET}:${timestamp}:${random}`).toString('base64');
  return token;
}

/**
 * Verify CSRF token from request
 * Returns error response if invalid, null if valid
 */
export async function verifyCSRF(request: NextRequest): Promise<NextResponse | null> {
  // Skip CSRF for GET requests (they are read-only)
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return null;
  }

  // Get tokens from header and cookie
  const headerToken = request.headers.get(CSRF_TOKEN_HEADER);
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;

  // Both tokens must be present
  if (!headerToken || !cookieToken) {
    return NextResponse.json(
      { error: 'CSRF token missing' },
      { status: 403 }
    );
  }

  // Tokens must match
  if (headerToken !== cookieToken) {
    return NextResponse.json(
      { error: 'CSRF token mismatch' },
      { status: 403 }
    );
  }

  // Verify token format (basic check)
  try {
    const decoded = Buffer.from(cookieToken, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    const secret = parts[0];
    const timestamp = parts[1];

    if (!secret || !timestamp) {
      return NextResponse.json(
        { error: 'Invalid CSRF token format' },
        { status: 403 }
      );
    }

    if (secret !== CSRF_SECRET) {
      return NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      );
    }

    // Check token age (24 hours max)
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    if (tokenAge > maxAge) {
      return NextResponse.json(
        { error: 'CSRF token expired' },
        { status: 403 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Invalid CSRF token format' },
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
