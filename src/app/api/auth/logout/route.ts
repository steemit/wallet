// POST /api/auth/logout
// Clear session
import { NextRequest, NextResponse } from 'next/server';
import { verifyCSRF } from '@/lib/middleware';

export async function POST(request: NextRequest) {
  try {
    // Security check
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

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
