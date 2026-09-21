// GET /api/auth/challenge?username=xxx
// Generate a login challenge for the user
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { setCSRFToken, rateLimit, rateLimitByUser, rateLimitConfigFromEnv } from '@/lib/middleware';
import { getRedis, redisKey } from '@/lib/cache/redis';

const CHALLENGE_TTL = 300; // 5 minutes

// Challenge-bearing responses must never be stored by browsers or
// intermediaries: a cached challenge would be signed by the client but
// verified at login against a different server-side value (guaranteed
// failure, or worse a stale-but-still-live value replayed elsewhere). The
// client-side fetch mirrors this with cache: 'no-store'.
function challengeResponse(payload: { success: true; challenge: string }): NextResponse {
  const response = NextResponse.json(payload);
  response.headers.set('Cache-Control', 'no-store');
  // Set CSRF token cookie (readable by JS, validated server-side)
  setCSRFToken(response);
  return response;
}

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
    //  - per-username: caps how many NEW challenges are minted for one
    //    account per window. When the cap trips we serve the EXISTING
    //    challenge instead of 429 — a hard 429 here would itself be a
    //    targeted auth-DoS (an attacker spending their quota locks the
    //    victim out of login entirely, F6/S2 re-verification 2026-09-04).
    // Tunable via RATE_LIMIT_AUTH_CHALLENGE_MAX / _WINDOW (see .env.example).
    const limitConfig = rateLimitConfigFromEnv('RATE_LIMIT_AUTH_CHALLENGE', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    const ipLimit = await rateLimit(request, 'auth_challenge', limitConfig);
    if (ipLimit) return ipLimit;

    const redis = getRedis();

    // Fail-closed, symmetric with the login route: issuing a challenge
    // REQUIRES Redis, because login verification later reads the stored
    // challenge. Previously a Redis outage silently skipped storage and still
    // returned 200 — handing out challenges that could never verify, and
    // leaving the route writing nothing while appearing healthy. Reject
    // instead (same error shape/status as login's fail-closed path).
    if (!redis) {
      console.error('Redis unavailable during challenge issuance — rejecting (fail-closed)');
      return NextResponse.json(
        { error: 'Login temporarily unavailable' },
        { status: 503 }
      );
    }

    const challengeKey = redisKey(`auth:challenge:${username}`);

    const userLimit = await rateLimitByUser(username, 'auth_challenge', limitConfig);
    if (userLimit) {
      // Per-username budget exhausted (attacker hammering this username, or
      // the user's own retries). Do NOT lock the account out: fall back to
      // the still-valid challenge so login remains possible. Only when none
      // exists do we surface the 429.
      try {
        const existing = await redis.get(challengeKey);
        if (existing) {
          const { challenge } = JSON.parse(existing) as {
            challenge: string;
            createdAt: number;
          };
          if (typeof challenge === 'string' && challenge.length > 0) {
            return challengeResponse({ success: true, challenge });
          }
          // Corrupted entry (no usable challenge): fall through to 429.
        }
      } catch {
        // Redis read failed — fall through to the 429 below.
      }
      return userLimit;
    }

    // S2 supplement: verify the account exists BEFORE touching Redis. This
    // endpoint is unauthenticated; without the check any syntactically valid
    // username string mints a Redis key. Cost: for single-account lookups
    // getAccounts also fetches pending recovery requests (legacy parity), so
    // each challenge request is two upstream RPCs — acceptable at the
    // route's 10/min/IP limit (and this mirrors the login route's own
    // existence check).
    try {
      const accounts = await SteemService.getAccounts([username]);
      if (!accounts || accounts.length === 0) {
        return NextResponse.json({ error: 'Account not found' }, { status: 400 });
      }
    } catch (error) {
      // Upstream lookup failed: do not mint keys for an unverified account —
      // fail closed (500) rather than fall back to writing the challenge.
      console.error('Challenge account lookup failed:', error);
      return NextResponse.json(
        { error: 'Failed to verify account' },
        { status: 500 }
      );
    }

    // Generate challenge
    const challenge = SteemService.generateChallenge(username);

    // Store challenge in Redis for later verification. F6/S2: SET NX so a
    // new challenge NEVER overwrites a live one — the overwrite primitive
    // (attacker refreshes the victim's challenge mid-signing, invalidating
    // the signature the victim is about to submit) is gone. While a
    // challenge is alive the same one is simply handed out again.
    const stored = await redis.set(
      challengeKey,
      JSON.stringify({ challenge, createdAt: Date.now() }),
      'EX',
      CHALLENGE_TTL,
      'NX'
    );
    if (stored !== 'OK') {
      // A live challenge already exists (set NX lost the race or a
      // previous one is still pending): return it instead of the fresh
      // one so client and server agree on the signed message.
      try {
        const existing = await redis.get(challengeKey);
        if (existing) {
          const existingChallenge = (JSON.parse(existing) as {
            challenge: string;
          }).challenge;
          if (typeof existingChallenge === 'string' && existingChallenge.length > 0) {
            return challengeResponse({
              success: true,
              challenge: existingChallenge,
            });
          }
          // Corrupted entry without a usable challenge: hand out the
          // freshly generated one. NX lost the race against the corrupt
          // key, so the fresh write did not land; the corrupt entry dies
          // at TTL (≤5 min) and the next request after that persists a
          // clean challenge. Login against the corrupt entry would fail
          // verification anyway — surfacing the fresh challenge here does
          // NOT weaken it: login still reads whatever is stored.
        }
      } catch {
        // Read failed after failed NX write — fall through and return the
        // freshly generated challenge. Worst case the client signs the new
        // one while Redis still holds an older entry; login fails once and
        // the retry (after TTL or successful login consumes the key) works.
      }
    }

    return challengeResponse({ success: true, challenge });
  } catch (error) {
    console.error('Error generating challenge:', error);
    return NextResponse.json(
      { error: 'Failed to generate challenge' },
      { status: 500 }
    );
  }
}
