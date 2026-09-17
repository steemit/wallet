import { describe, it, expect } from 'vitest';
import { SteemService } from '@/lib/steem/server';
import type { SignedTransaction } from '@/lib/steem/types';

// A real secp256k1 recoverable signature: 65 bytes → 130 hex chars
// (produced with steem.auth.signTransaction; content is irrelevant here).
const VALID_SIG =
  '20602eb91e0eb4641ad86c249044c0a9cf6348d5a08e9e636990effa8ee20f4f7912959b3c8e05486d702a8ead27f628f3e99fc3589637e741255086aa063e6fc0';

const validTx: SignedTransaction = {
  ref_block_num: 1,
  ref_block_prefix: 1,
  expiration: '2026-01-01T00:00:00',
  operations: [['recover_account', { account_to_recover: 'alice' }]],
  extensions: [],
  signatures: [VALID_SIG],
};

describe('SteemService.validateRecoveryTransactionShape (F12: bounds before sync ECDSA)', () => {
  it('accepts a well-formed single-signature transaction', () => {
    expect(SteemService.validateRecoveryTransactionShape(validTx)).toBe(true);
  });

  it('accepts a multi-signature transaction within the bound (≤4)', () => {
    const tx: SignedTransaction = { ...validTx, signatures: [VALID_SIG, VALID_SIG, VALID_SIG, VALID_SIG] };
    expect(SteemService.validateRecoveryTransactionShape(tx)).toBe(true);
  });

  it.each([
    { label: '5 signatures (just over bound)', sigs: 5 },
    { label: '1000 signatures (DoS payload)', sigs: 1000 },
  ])('rejects: $label', ({ sigs }) => {
    const tx: SignedTransaction = {
      ...validTx,
      signatures: Array.from({ length: sigs }, () => VALID_SIG),
    };
    expect(SteemService.validateRecoveryTransactionShape(tx)).toBe(false);
  });

  it('rejects an empty signatures array', () => {
    const tx: SignedTransaction = { ...validTx, signatures: [] };
    expect(SteemService.validateRecoveryTransactionShape(tx)).toBe(false);
  });

  it.each([
    { label: 'non-hex garbage', sig: 'SIG123' },
    { label: 'wrong length hex (64 chars)', sig: 'a'.repeat(64) },
    { label: 'right length, non-hex chars', sig: 'z'.repeat(130) },
    { label: 'non-string entry (number)', sig: 12345 },
  ])('rejects malformed signature: $label', ({ sig }) => {
    const tx = { ...validTx, signatures: [sig] } as unknown as SignedTransaction;
    expect(SteemService.validateRecoveryTransactionShape(tx)).toBe(false);
  });

  it.each([
    { label: '11 operations (just over bound)', ops: 11 },
    { label: '100 operations', ops: 100 },
  ])('rejects: $label', ({ ops }) => {
    const tx: SignedTransaction = {
      ...validTx,
      operations: Array.from({ length: ops }, (_, i) => [
        'recover_account',
        { account_to_recover: `alice${i}` },
      ]) as SignedTransaction['operations'],
    };
    expect(SteemService.validateRecoveryTransactionShape(tx)).toBe(false);
  });

  it('still applies the base shape rules (missing refs, empty expiration, …)', () => {
    expect(
      SteemService.validateRecoveryTransactionShape({ ...validTx, expiration: '' })
    ).toBe(false);
    expect(
      SteemService.validateRecoveryTransactionShape({ ...validTx, ref_block_num: NaN })
    ).toBe(false);
    expect(
      SteemService.validateRecoveryTransactionShape({ ...validTx, operations: [] })
    ).toBe(false);
  });

  it('relay shape validation stays UNBOUNDED (relay exemption per AGENTS.md)', () => {
    // The pure-relay validateTransactionShape must NOT gain the cap: the
    // 2026-08-15 architecture review ruled the relay performs no content
    // validation. If this test fails, someone leaked the recovery-only
    // bound into the shared relay path.
    const tx: SignedTransaction = {
      ...validTx,
      signatures: Array.from({ length: 500 }, () => VALID_SIG),
    };
    expect(SteemService.validateTransactionShape(tx)).toBe(true);
  });
});
