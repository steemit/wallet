import type { SignedTransaction } from './types';

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
