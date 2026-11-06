import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import { VaultError } from '@/lib/vault/errors';

const v = vectors.vault;

describe('vault development test vectors fixture', () => {
  it('pins the V1 hierarchy, shared salt and public notes', () => {
    expect(vectors.meta.warning).toContain('TEST-ONLY DATA');
    expect(vectors.meta.vaultAad).toBe('steem-wallet.vault.v1');
    expect(v.envelope).toEqual({
      version: 1,
      vaultName: 'work',
      salt: v.salt,
      accounts: [
        {
          accountName: 'alice',
          keys: {
            owner: [],
            active: [
              {
                iv: v.keys[1]?.iv,
                ciphertext: v.keys[1]?.ciphertext,
                note: 'backup active key',
              },
            ],
            posting: [
              {
                iv: v.keys[0]?.iv,
                ciphertext: v.keys[0]?.ciphertext,
                note: 'desktop posting key',
              },
            ],
            memo: [],
          },
        },
      ],
    });
    expect(Object.keys(v.envelope).sort()).toEqual(['accounts', 'salt', 'vaultName', 'version']);
  });

  it('pins exact per-key cryptographic values and lengths', () => {
    expect(v.kekHex).toBe('710b0dc492120ad6996015c45cd4de5594e17afc2bffc8c6410e86f29f73f085');
    expect(v.keys[0]?.ciphertext).toBe(
      'KY7ndcB5-cEyCbpGnCjRTdEwUlDfkXaSO7yvAphdJ5A9pvzp2IauP553-NPuSZhP1jDU3qQgycUTU6TpLBqr0J4UFw',
    );
    expect(v.keys[1]?.ciphertext).toBe(
      'cUdTlcA1-6ObSrwmQXzhbDA8G-d3nJOvFytG4AoBu-cin2gBquPax32Pe1VyBuFfPVOv48AazSV8n9lDk2HxWzQT_w',
    );
    expect(v.reencryption.ciphertext).toBe(
      'II3Ojfg6EpPjW_1APfIMo1DvSy7x4AW0QZL3PYMkyRKpDbhC9E2KVGCVQgwxznOS1t8GduzELM0RXg76jjxFk0fqCQ',
    );
    for (const key of v.keys) {
      expect(key.plaintextBytes).toBe(51);
      expect(key.ciphertextBytes).toBe(67);
    }
  });

  it('contains no retired flat payload, root ciphertext or hidden identifiers', () => {
    const serialized = JSON.stringify(v.envelope);
    for (const field of ['payloadText', 'privateKey', 'vaultId', 'keyId', 'wrappedDataKey']) {
      expect(serialized).not.toContain(field);
    }
    expect(v.envelope).not.toHaveProperty('iv');
    expect(v.envelope).not.toHaveProperty('ciphertext');
    expect(v.emptyEnvelope.accounts).toEqual([]);
  });

  it('uses a fresh IV for the same-key reencryption vector', () => {
    expect(v.reencryption.iv).not.toBe(v.keys[0]?.iv);
    expect(v.reencryption.ciphertext).not.toBe(v.keys[0]?.ciphertext);
  });

  it('keeps the exact transaction and dapp fixture nodes available', () => {
    expect(vectors.exactTransaction.transactionId).toBe(
      '07c1af89bc7bfbbe2b9261e0b6cb3bf231b98c4d',
    );
    expect(vectors.exactTransaction.signedTx.signatures[0]).toBe(
      '1f1fdbe1fc5649b7e0c6daa367b90110da4275269b742ee05570cadae24880d6287a5c9df8244fe274bc80dce22ae852aef277404548da51ffef1f0fe56903ba69',
    );
    expect(vectors.dappRequest.signature).toHaveLength(130);
    expect(vectors.dappRequest.payloadBase64url).toBe(
      vectors.dappRequest.signedMessage.split('\n')[1],
    );
  });
});

describe('VaultError', () => {
  it('preserves code and message', () => {
    const error = new VaultError('VAULT_LOCKED', 'vault is locked');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'VaultError', code: 'VAULT_LOCKED' });
  });
});
