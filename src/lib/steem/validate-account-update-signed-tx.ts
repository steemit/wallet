import { steem } from '@steemit/steem-js';

import type { SignedTransaction } from '@/lib/steem/types';

/** Validate signed tx shape for account_update broadcast (does not verify signatures). */
export function validateAccountUpdateSignedTx(signedTx: SignedTransaction): string | null {
  if (!Array.isArray(signedTx.extensions)) {
    return 'extensions must be an array';
  }
  if (!Array.isArray(signedTx.operations) || signedTx.operations.length === 0) {
    return 'missing operations';
  }
  const op = signedTx.operations[0];
  if (!Array.isArray(op) || op.length !== 2 || op[0] !== 'account_update') {
    return 'first operation must be account_update';
  }
  const payload = op[1];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'account_update payload must be an object';
  }
  try {
    steem.auth.sanitizeAccountUpdatePayload(payload as Record<string, unknown>);
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid account_update payload';
  }
  return null;
}
