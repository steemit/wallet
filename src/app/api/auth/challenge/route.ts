// GET /api/auth/challenge?username=xxx
// Generate a login challenge for the user
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { setCSRFToken } from '@/lib/middleware';
import { getRedis } from '@/lib/cache/redis';

const CHALLENGE_TTL = 300; // 5 minutes

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

    // Store challenge in Redis for later verification
    const redis = getRedis();
    if (redis) {
      await redis.set(
        `auth:challenge:${username}`,
        JSON.stringify({ challenge, createdAt: Date.now() }),
        'EX',
        CHALLENGE_TTL
      );
    }

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
