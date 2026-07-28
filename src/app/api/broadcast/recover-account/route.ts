// POST /api/broadcast/recover-account
// Broadcast a signed recover_account transaction (step 2 of account recovery)
import { NextRequest, NextResponse } from 'next/server';
import { steem } from '@steemit/steem-js';
import { eq } from 'drizzle-orm';
import { SteemService } from '@/lib/steem/server';
import { verifyCSRF, rateLimit } from '@/lib/middleware';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';
import type { SignedTransaction } from '@/lib/steem/types';

interface RecoverAccountOperation {
  account_to_recover: string;
  new_owner_authority: {
    weight_threshold: number;
    account_auths: [string, number][];
    key_auths: [string, number][];
  };
  recent_owner_authority: {
    weight_threshold: number;
    account_auths: [string, number][];
    key_auths: [string, number][];
  };
}

export async function POST(request: NextRequest) {
  try {
    const csrfError = await verifyCSRF(request);
    if (csrfError) return csrfError;

    const rateLimitError = await rateLimit(request, 'broadcast', {
      maxRequests: 3,
      windowSeconds: 60,
    });
    if (rateLimitError) return rateLimitError;

    const { signedTx } = (await request.json()) as {
      signedTx: SignedTransaction;
    };

    if (!signedTx) {
      return NextResponse.json(
        { error: 'Missing signed transaction' },
        { status: 400 }
      );
    }

    const isValid = SteemService.validateTransactionShape(signedTx);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid transaction format' }, { status: 400 });
    }

    const op0 = signedTx.operations?.[0];
    if (!Array.isArray(op0) || op0[0] !== 'recover_account') {
      return NextResponse.json(
        { error: 'Invalid transaction: expected recover_account operation' },
        { status: 400 }
      );
    }

    // Deep validate the operation body structure
    const opBody = op0[1] as unknown as RecoverAccountOperation;
    if (
      !opBody ||
      typeof opBody.account_to_recover !== 'string' ||
      !opBody.new_owner_authority ||
      !opBody.recent_owner_authority ||
      typeof opBody.new_owner_authority.weight_threshold !== 'number' ||
      !Array.isArray(opBody.new_owner_authority.key_auths) ||
      typeof opBody.recent_owner_authority.weight_threshold !== 'number' ||
      !Array.isArray(opBody.recent_owner_authority.key_auths)
    ) {
      return NextResponse.json(
        { error: 'Invalid recover_account operation body' },
        { status: 400 }
      );
    }

    // Cryptographically verify the signature against the REAL historical owner
    // keys fetched from chain — NOT the recent_owner_authority declared in the
    // op body (which is attacker-controlled and trivially self-satisfiable).
    //
    // recover_account is signed by the account's OLD owner key, which may no
    // longer be in the account's current authority set. We fetch the on-chain
    // owner-key change history (get_owner_history) and verify the signature
    // against every previous owner public key recorded there. This proves the
    // signer actually held the old owner authority for this account.
    // (requires @steemit/steem-js >=1.0.20)
    const claimedRecentKey = opBody.recent_owner_authority.key_auths?.[0]?.[0];
    if (!claimedRecentKey) {
      return NextResponse.json(
        { error: 'Invalid recent_owner_authority: missing key_auth' },
        { status: 400 }
      );
    }

    let ownerHistory: { previous_owner_authority?: { key_auths?: [string, number][] } }[];
    try {
      ownerHistory = await SteemService.getOwnerHistory(opBody.account_to_recover);
    } catch {
      return NextResponse.json(
        { error: 'Could not verify signer (owner history lookup failed)' },
        { status: 503 }
      );
    }

    // Collect all real historical owner public keys from the chain.
    const historicalOwnerKeys = new Set<string>();
    for (const entry of ownerHistory) {
      for (const [pubKey] of entry.previous_owner_authority?.key_auths ?? []) {
        if (pubKey) historicalOwnerKeys.add(pubKey);
      }
    }

    // The key declared in the op body must match a real historical owner key.
    if (!historicalOwnerKeys.has(claimedRecentKey)) {
      return NextResponse.json(
        { error: 'recent_owner_authority does not match any historical owner key' },
        { status: 400 }
      );
    }

    // Verify the transaction signature against the claimed (now validated) key.
    if (!steem.auth.verifyTransaction(
      signedTx as unknown as Record<string, unknown>,
      claimedRecentKey
    )) {
      return NextResponse.json(
        { error: 'Transaction signature does not match recent_owner_authority' },
        { status: 400 }
      );
    }

    // Cross-check against DB: the account must have a closed recovery record
    // with a matching new_owner_key. Together with the on-chain signature
    // verification above and the on-chain request_account_recovery, this forms
    // the layered defense on the account-takeover path. When the DB is
    // unavailable we must refuse to broadcast (503), matching recovery/request
    // and recovery/confirm. Never fail open here.
    const db = getDb();
    if (!db) {
      console.error('Database unavailable for recover-account broadcast');
      return NextResponse.json(
        { error: 'Service unavailable' },
        { status: 503 }
      );
    }

    const newKey = opBody.new_owner_authority.key_auths?.[0]?.[0];
    if (!newKey) {
      return NextResponse.json(
        { error: 'Invalid new_owner_authority: missing key_auth' },
        { status: 400 }
      );
    }

    const record = await db.query.arecs.findFirst({
      where: eq(arecs.accountName, opBody.account_to_recover),
      columns: { id: true, status: true, newOwnerKey: true },
    });

    if (!record || record.status !== 'closed') {
      return NextResponse.json(
        { error: 'No confirmed recovery request found for this account' },
        { status: 400 }
      );
    }

    if (!record.newOwnerKey || record.newOwnerKey !== newKey) {
      return NextResponse.json(
        { error: 'new_owner_key does not match recovery record' },
        { status: 400 }
      );
    }

    const txForBroadcast = steem.auth.normalizeTransactionForBroadcast(
      signedTx as unknown as Record<string, unknown>
    ) as unknown as SignedTransaction;

    const result = await SteemService.broadcastTransaction(txForBroadcast);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Broadcast recover-account error:', error);
    return NextResponse.json(
      { error: 'Failed to broadcast transaction' },
      { status: 500 }
    );
  }
}
