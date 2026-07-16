import { describe, it, expect } from 'vitest';
import { assertSignedTxOpType } from '@/lib/steem/validate-signed-tx-op';
import type { SignedTransaction } from '@/lib/steem/types';

function makeTx(op: [string, unknown]): SignedTransaction {
  return {
    ref_block_num: 1,
    ref_block_prefix: 2,
    expiration: '2026-07-10T00:00:00',
    operations: [op],
    extensions: [],
    signatures: ['sig'],
  } as unknown as SignedTransaction;
}

describe('assertSignedTxOpType', () => {
  it('returns null when the first operation matches the expected type', () => {
    expect(assertSignedTxOpType(makeTx(['transfer', {}]), 'transfer')).toBeNull();
    expect(assertSignedTxOpType(makeTx(['custom_json', {}]), 'custom_json')).toBeNull();
  });

  it('returns an error when the operation type does not match', () => {
    // This is the core security check: a transfer must not be relayed via the
    // vote route, etc.
    const res = assertSignedTxOpType(makeTx(['transfer', {}]), 'vote');
    expect(res).toBe('Invalid transaction: expected vote operation');
  });

  it('returns an error when there are no operations', () => {
    const tx = {
      ref_block_num: 1,
      ref_block_prefix: 2,
      expiration: '2026-07-10T00:00:00',
      operations: [],
      extensions: [],
      signatures: ['sig'],
    } as unknown as SignedTransaction;
    expect(assertSignedTxOpType(tx, 'transfer')).not.toBeNull();
  });

  it('returns an error when the operation is not a tuple', () => {
    const tx = {
      ref_block_num: 1,
      ref_block_prefix: 2,
      expiration: '2026-07-10T00:00:00',
      operations: ['not-a-tuple'],
      extensions: [],
      signatures: ['sig'],
    } as unknown as SignedTransaction;
    expect(assertSignedTxOpType(tx, 'transfer')).not.toBeNull();
  });
});
