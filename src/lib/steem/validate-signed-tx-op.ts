import { NextResponse } from 'next/server';
import type { SignedTransaction } from './types';
import { SteemService } from './server';

/** The Steem authority level required to sign an operation. */
export type RequiredAuthority = 'owner' | 'active' | 'posting';

/**
 * Map each relayed operation type to the authority required to sign it on-chain.
 * Used to ensure the signature is checked against the correct key set (e.g. a
 * `transfer` signed with the memo key is rejected at the relay, not just by the
 * chain). `memo` is never a valid signing authority for any operation.
 *
 * Reference: Steem operation permissions (steem-js / chain consensus).
 */
const OP_AUTHORITY: Record<string, RequiredAuthority> = {
  // active authority
  transfer: 'active',
  convert: 'active',
  limit_order_create: 'active',
  limit_order_cancel: 'active',
  delegate_vesting_shares: 'active',
  withdraw_vesting: 'active',
  set_withdraw_vesting_route: 'active',
  account_create: 'active',
  account_witness_vote: 'active',
  account_witness_proxy: 'active',
  create_proposal: 'active',
  update_proposal_votes: 'active',
  remove_proposal: 'active',
  // posting authority
  vote: 'posting',
  custom_json: 'posting',
};

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
 * Resolve the on-chain required authority for an operation type. Defaults to
 * 'active' for unknown ops (a conservative choice — active is the most common
 * signing authority and memo is never valid).
 */
export function getRequiredAuthority(opType: string): RequiredAuthority {
  return OP_AUTHORITY[opType] ?? 'active';
}

/**
 * Combined relay validation for broadcast routes: enforces the operation type
 * AND performs real cryptographic signature verification against the claimed
 * account (via @steemit/steem-js >=1.0.20 `verifyTransaction`).
 *
 * The signature is checked against only the key set for the operation's required
 * authority (e.g. a `transfer` must be signed by an active key, not a memo key).
 * This strengthens defense-in-depth: the chain would also reject a wrong-authority
 * signature, but checking here avoids relaying doomed transactions and closes the
 * gap where any account key (including memo) was accepted.
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
  //    a key of the REQUIRED authority belonging to the claimed account.
  const requiredAuth = getRequiredAuthority(expectedOp);
  const result = await SteemService.verifyTransactionForUsername(signedTx, username, requiredAuth);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Transaction verification failed' }, { status: 400 });
  }

  return null;
}
