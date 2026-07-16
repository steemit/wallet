import { NextResponse } from 'next/server';
import type { SignedTransaction } from './types';
import { SteemService } from './server';

/**
 * Verify that the first operation in a signed transaction has the expected type.
 *
 * Relay routes must assert that the operation matches the route's intent before
 * forwarding — otherwise an attacker can submit any signed operation through any
 * route (e.g. post a `transfer` to the higher-rate-limit `/vote` route). Returns
 * an error string when the op type does not match, or `null` when it does.
 *
 * This is a structural check only; it does not verify signatures.
 */
export function assertSignedTxOpType(
  signedTx: SignedTransaction,
  expected: string
): string | null {
  const op0 = signedTx.operations?.[0];
  if (!Array.isArray(op0) || op0.length < 2 || op0[0] !== expected) {
    return `Invalid transaction: expected ${expected} operation`;
  }
  return null;
}

/**
 * Combined relay validation for broadcast routes: enforces the operation type
 * AND performs real cryptographic signature verification against the claimed
 * account (via @steemit/steem-js >=1.0.20 `verifyTransaction`).
 *
 * Returns a 400/503 NextResponse on failure, or `null` when the transaction is
 * valid and may be relayed. Call this before `broadcastTransaction`.
 *
 * @param signedTx  the client-signed transaction
 * @param expectedOp  the operation name this route is allowed to relay
 * @param username  the account claimed to have signed (from the request body)
 */
export async function validateRelayTransaction(
  signedTx: SignedTransaction,
  expectedOp: string,
  username: string
): Promise<NextResponse | null> {
  // 1. Operation type must match the route's intent.
  const opTypeError = assertSignedTxOpType(signedTx, expectedOp);
  if (opTypeError) {
    return NextResponse.json({ error: opTypeError }, { status: 400 });
  }

  // 2. Cryptographic signature verification: the transaction must be signed by
  //    a key belonging to the claimed account. This is the server-side defense
  //    that closes the audit's Critical #1 gap (previously shape-only).
  const result = await SteemService.verifyTransactionForUsername(signedTx, username);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Transaction verification failed' }, { status: 400 });
  }

  return null;
}
