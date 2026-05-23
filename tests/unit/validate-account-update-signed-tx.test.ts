import { describe, it, expect } from 'vitest';
import type { SignedTransaction } from '@/lib/steem/types';
import { validateAccountUpdateSignedTx } from '@/lib/steem/validate-account-update-signed-tx';

function baseTx(payload: Record<string, unknown>): SignedTransaction {
  return {
    ref_block_num: 1,
    ref_block_prefix: 2,
    expiration: '2030-01-01T00:00:00',
    extensions: [],
    signatures: ['SIG'],
    operations: [['account_update', payload]],
  };
}

const validPayload = {
  account: 'alice',
  owner: { weight_threshold: 1, account_auths: [], key_auths: [['STMowner', 1]] },
  active: { weight_threshold: 1, account_auths: [], key_auths: [['STMactive', 1]] },
  posting: { weight_threshold: 1, account_auths: [], key_auths: [['STMpost', 1]] },
  memo_key: 'STMmemo',
  json_metadata: '{}',
};

describe('validateAccountUpdateSignedTx', () => {
  it('accepts chain-safe account_update payload', () => {
    expect(validateAccountUpdateSignedTx(baseTx(validPayload))).toBeNull();
  });

  it('rejects array-shaped owner authority', () => {
    const error = validateAccountUpdateSignedTx(
      baseTx({
        ...validPayload,
        owner: [['STMbad', 1]],
      })
    );
    expect(error).toMatch(/Invalid owner authority/);
  });

  it('accepts flat_map key_auths objects (normalized to tuple pairs for condenser broadcast)', () => {
    expect(
      validateAccountUpdateSignedTx(
        baseTx({
          ...validPayload,
          owner: {
            weight_threshold: 1,
            account_auths: {},
            key_auths: { STMowner: 1 },
          },
          active: {
            weight_threshold: 1,
            account_auths: {},
            key_auths: { STMactive: 1 },
          },
          posting: {
            weight_threshold: 1,
            account_auths: {},
            key_auths: { STMpost: 1 },
          },
        })
      )
    ).toBeNull();
  });

  it('accepts object json_metadata (coerced by steem.auth.sanitizeAccountUpdatePayload)', () => {
    expect(
      validateAccountUpdateSignedTx(
        baseTx({
          ...validPayload,
          json_metadata: { profile: { name: 'alice' } },
        })
      )
    ).toBeNull();
  });
});
