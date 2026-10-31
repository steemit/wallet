// A0 contract test: proves the vault development test-vector fixture ships
// as parseable JSON with the pinned values, and covers the VaultError class.
//
// The WIFs and passwords in the fixture are public test-only data; the crypto
// vectors themselves are recomputed (not just asserted) in A1's
// vault-envelope / vault-crypto tests — here we pin the contract shape and
// the exact fixture values.
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { VaultError } from '@/lib/vault/errors';

describe('vault development test vectors fixture', () => {
  it('parses as JSON with the expected top-level nodes', () => {
    expect(vectors.meta.warning).toContain('TEST-ONLY DATA');
    expect(vectors.vault).toBeTruthy();
    expect(vectors.dappRequest).toBeTruthy();
    expect(vectors.exactTransaction).toBeTruthy();
  });

  it('pins the fixed vault AAD', () => {
    expect(vectors.meta.vaultAad).toBe('steem-wallet.vault.v1');
  });

  it('provides non-empty vault encryption inputs', () => {
    const vault = vectors.vault;
    const stringFields = ['password', 'salt', 'iv', 'payloadText'] as const;
    for (const field of stringFields) {
      expect(typeof vault[field]).toBe('string');
      expect(vault[field].length).toBeGreaterThan(0);
    }
  });

  // Exact pins guard against fixture corruption / replacement with well-formed wrong values.
  it('pins the exact vault crypto vector values', () => {
    const vault = vectors.vault;
    expect(vault.kekHex).toBe(
      '710b0dc492120ad6996015c45cd4de5594e17afc2bffc8c6410e86f29f73f085',
    );
    expect(vault.ciphertext).toBe(
      'Z-a5VsBloswvNs1JynzsD9oiXX2LsmPDLLX1X5BKT-hZkfzU9972X4tJ-vbCT7tekGLczkyNBEXVbPT-4EeW5PPgU8e0ESOmniNNQbHxGhyyxx-bgWGBV3HgduXVOsXcjU6XZ3ACeTXxIqfYMTLbp62a1gXpGc--5CArB5FGIqt5eGW4gPA',
    );
    expect(vault.reencryption.ciphertext).toBe(
      'buWQrvgmSZ7-ZIpPa6Yx4Vv9RAOlwxDlVputYIszoWrNOrh_2xXSNHWrQCkdyFCDkI0OIaPQvolXWgrresgk45_9MTap3WR1oH736giDce0jJC0dO_u0InHQMnGMsMcb1f1pVCnCAT1nzxi2hPY-eChtWEKBQ6O_q-kSApOWXwvkWJtVKSM',
    );
    expect(vault.emptyPayload.ciphertext).toBe(
      'Py98yM4soK-WYPXNLTPFFVQXwgKWTRHrAswR',
    );
  });

  it('payloadText matches the canonical serialization of payload', () => {
    expect(vectors.vault.payloadText).toBe(
      JSON.stringify(vectors.vault.payload),
    );
    expect(vectors.vault.emptyPayload.payloadText).toBe(
      JSON.stringify({ keys: [] }),
    );
  });

  it('pins the plaintext/ciphertext byte-length relation (GCM tag appended)', () => {
    expect(vectors.vault.plaintextBytes).toBe(118);
    expect(vectors.vault.ciphertextBytes).toBe(134);
  });

  it('re-encryption uses a fresh IV and produces a different ciphertext', () => {
    expect(vectors.vault.reencryption.iv).not.toBe(vectors.vault.iv);
    expect(vectors.vault.reencryption.ciphertext).not.toBe(vectors.vault.ciphertext);
  });

  it('provides a complete empty-payload vector', () => {
    const empty = vectors.vault.emptyPayload;
    expect(empty.payloadText).toBe('{"keys":[]}');
    expect(typeof empty.iv).toBe('string');
    expect(empty.iv.length).toBeGreaterThan(0);
  });

  // Exact pins guard against fixture corruption / replacement with well-formed wrong values.
  it('pins the exact transaction ids and signature', () => {
    expect(vectors.exactTransaction.transactionId).toBe(
      '07c1af89bc7bfbbe2b9261e0b6cb3bf231b98c4d',
    );
    expect(vectors.exactTransaction.withEmptySignaturesTransactionId).toBe(
      '4b34b37515f299094b8e105f937f5b599ea95a1e',
    );
    expect(vectors.exactTransaction.signedTx.signatures[0]).toBe(
      '1f1fdbe1fc5649b7e0c6daa367b90110da4275269b742ee05570cadae24880d6287a5c9df8244fe274bc80dce22ae852aef277404548da51ffef1f0fe56903ba69',
    );
  });

  it('provides a 130-character dapp request signature', () => {
    expect(vectors.dappRequest.signatureLength).toBe(130);
    expect(vectors.dappRequest.signature).toHaveLength(130);
  });
});

describe('VaultError', () => {
  it('preserves code and message and is an Error', () => {
    const error = new VaultError('VAULT_LOCKED', 'vault is locked');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('VaultError');
    expect(error.code).toBe('VAULT_LOCKED');
    expect(error.message).toBe('vault is locked');
  });
});
