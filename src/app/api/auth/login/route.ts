// POST /api/auth/login
// Verify signed challenge and create session
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getRedis, redisKey } from '@/lib/cache/redis';
import { buildUserLoginPayload } from '@/lib/analytics/overseer-payload';

export async function POST(request: NextRequest) {
  try {
    // Security checks
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'login', {
      maxRequests: 10,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    // Malformed JSON is a client error, not a server fault. Parse in its own
    // try/catch so a garbage body gets a 400 instead of falling through to
    // the outer catch (which surfaced as a 500). Same convention as the
    // challenge route's input validation: reject bad input with 4xx, never
    // 5xx.
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { username, signedChallenge, publicKey } = parsed as {
      username?: string;
      signedChallenge?: string;
      publicKey?: string;
    };

    // Validate required fields
    if (!username || !signedChallenge || !publicKey) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Retrieve challenge from Redis. Challenge verification REQUIRES Redis —
    // without it we cannot prove the client holds the private key, so reject
    // rather than authenticating on a public-key match alone (fail-closed).
    const redis = getRedis();
    if (!redis) {
      console.error('Redis unavailable during login — rejecting (fail-closed)');
      return NextResponse.json(
        { error: 'Login temporarily unavailable' },
        { status: 503 }
      );
    }

    const stored = await redis.get(redisKey(`auth:challenge:${username}`));
    if (!stored) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge' },
        { status: 401 }
      );
    }

    const { challenge } = JSON.parse(stored) as { challenge: string; createdAt: number };

    // Verify the signature against the stored challenge
    const isValid = SteemService.verifyChallengeSignature(
      challenge,
      signedChallenge,
      publicKey
    );

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Atomic one-time consumption via GETDEL (Redis >= 6.2; the deployment
    // baseline is ElastiCache Redis 7+ — see docs/CACHING_AND_DEGRADATION.md
    // §2.6). The previous get → verify → del sequence allowed two concurrent
    // requests carrying the same valid signature to both pass verification
    // before the delete landed, so "one-time" was not actually enforced
    // against races. Ordering here is deliberate:
    //   - verification happens BEFORE the consume, so a failed-signature
    //     attempt never burns the challenge (the client can retry with the
    //     same one);
    //   - the consume itself is atomic, so of several concurrent requests
    //     presenting the same valid signature exactly one wins — the rest
    //     see a null return and get the same rejection as a missing or
    //     expired challenge. This is what makes the documented "one-time"
    //     replay guarantee actually true.
    const consumed = await redis.getdel(redisKey(`auth:challenge:${username}`));
    if (!consumed) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge' },
        { status: 401 }
      );
    }

    // Get the account to verify the public key belongs to it
    const accounts = await SteemService.getAccounts([username]);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    const account = accounts[0];

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Verify the public key matches one of the account's keys
    const activeKey = account.active?.key_auths?.[0]?.[0];
    const postingKey = account.posting?.key_auths?.[0]?.[0];
    const ownerKey = account.owner?.key_auths?.[0]?.[0];
    const memoKey = account.memo_key;

    const validKeys = [activeKey, postingKey, ownerKey, memoKey].filter(Boolean);
    const isValidKey = validKeys.includes(publicKey);

    if (!isValidKey) {
      return NextResponse.json(
        { error: 'Public key does not match account' },
        { status: 401 }
      );
    }

    // Legacy `/login_account` checkpoint: overseer measurement `user_login`.
    // Do not await — a slow/missing overseer must not delay the session response.
    void SteemService.collectOverseer(buildUserLoginPayload(account.name));

    // Return success with account info
    return NextResponse.json({
      success: true,
      username: account.name,
      publicKey,
      account: {
        name: account.name,
        balance: account.balance,
        sbd_balance: account.sbd_balance,
        vesting_shares: account.vesting_shares,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
