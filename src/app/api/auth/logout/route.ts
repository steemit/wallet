// POST /api/auth/logout
// Clear session
import { NextRequest, NextResponse } from 'next/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';

export async function POST(request: NextRequest) {
  try {
    // Security check
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    // Same auth-scope rate limiting pattern as login/challenge. Logout is a
    // stateless no-op, but without a limit it was the only /api/auth POST
    // without one — an unbounded (CSRF-verified) request surface.
    const rateLimitError = await rateLimit(request, 'auth_logout', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    // In a stateless API, logout is handled client-side
    // by clearing the Redux store and any stored tokens
    // If using sessions, clear the session here

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
