// A0 contract test: proves the vault development test-vector fixture ships
// as parseable JSON with the pinned values, and covers the VaultError class.
//
// The WIFs and passwords in the fixture are public test-only data; the crypto
// vectors themselves are recomputed (not just asserted) in A1's
// vault-envelope / vault-crypto tests — here we only pin the contract shape.
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { VaultError } from '@/lib/vault/errors';

describe('vault development test vectors fixture', () => {
  it('parses as JSON with the expected top-level nodes', () => {
    expect(vectors).toBeTruthy();
    expect(vectors.meta.warning).toContain('TEST-ONLY DATA');
    expect(vectors.vault).toBeTruthy();
    expect(vectors.dappRequest).toBeTruthy();
    expect(vectors.exactTransaction).toBeTruthy();
  });

  it('pins the fixed vault AAD', () => {
    expect(vectors.meta.vaultAad).toBe('steem-wallet.vault.v1');
  });

  it('provides non-empty vault encryption inputs and outputs', () => {
    const vault = vectors.vault;
    const stringFields = [
      'password',
      'salt',
      'iv',
      'payloadText',
      'kekHex',
      'ciphertext',
    ] as const;
    for (const field of stringFields) {
      expect(typeof vault[field]).toBe('string');
      expect(vault[field].length).toBeGreaterThan(0);
    }
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
    expect(typeof empty.ciphertext).toBe('string');
    expect(empty.ciphertext.length).toBeGreaterThan(0);
  });

  it('provides a 40-hex-char exact transaction id', () => {
    expect(vectors.exactTransaction.transactionId).toMatch(/^[0-9a-f]{40}$/);
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
