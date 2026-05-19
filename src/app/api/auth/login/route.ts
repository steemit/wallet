// POST /api/auth/login
// Verify signed challenge and create session
import { NextRequest, NextResponse } from 'next/server';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getRedis } from '@/lib/cache/redis';

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

    const body = await request.json();
    const { username, signedChallenge, publicKey } = body;

    // Validate required fields
    if (!username || !signedChallenge || !publicKey) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Retrieve challenge from Redis
    const redis = getRedis();
    if (redis) {
      const stored = await redis.get(`auth:challenge:${username}`);
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

      // Delete challenge (one-time use)
      await redis.del(`auth:challenge:${username}`);
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
