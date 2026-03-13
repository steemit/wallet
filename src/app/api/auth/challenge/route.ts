// GET /api/auth/challenge?username=xxx
// Generate a login challenge for the user
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { setCSRFToken } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }

    // Validate username format
    if (!/^[a-z0-9.-]+$/.test(username) || username.length < 3 || username.length > 16) {
      return NextResponse.json(
        { error: 'Invalid username format' },
        { status: 400 }
      );
    }

    // Generate challenge
    const challenge = SteemService.generateChallenge(username);

    const response = NextResponse.json({
      success: true,
      challenge,
    });

    // Set CSRF token cookie (readable by JS, validated server-side)
    setCSRFToken(response);

    return response;
  } catch (error) {
    console.error('Error generating challenge:', error);
    return NextResponse.json(
      { error: 'Failed to generate challenge' },
      { status: 500 }
    );
  }
}
