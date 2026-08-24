// GET /api/auth/challenge?username=xxx
// Generate a login challenge for the user
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { setCSRFToken, rateLimit, rateLimitByUser, rateLimitConfigFromEnv } from '@/lib/middleware';
import { getRedis, redisKey } from '@/lib/cache/redis';

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

    // Rate limit BEFORE any Redis write. Two dimensions:
    //  - per-IP: bounds the write-amplification surface (this endpoint is
    //    unauthenticated; without a limit it can drive unbounded Redis writes).
    //  - per-username: an attacker hammering challenges for one victim
    //    otherwise overwrites the victim's challenge on every attempt,
    //    locking them out of login (targeted auth DoS).
    // Tunable via RATE_LIMIT_AUTH_CHALLENGE_MAX / _WINDOW (see .env.example).
    const limitConfig = rateLimitConfigFromEnv('RATE_LIMIT_AUTH_CHALLENGE', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    const ipLimit = await rateLimit(request, 'auth_challenge', limitConfig);
    if (ipLimit) return ipLimit;

    const userLimit = await rateLimitByUser(username, 'auth_challenge', limitConfig);
    if (userLimit) return userLimit;

    // Generate challenge
    const challenge = SteemService.generateChallenge(username);

    // Store challenge in Redis for later verification
    const redis = getRedis();
    if (redis) {
      await redis.set(
        redisKey(`auth:challenge:${username}`),
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
