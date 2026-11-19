import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import {
  VAULT_IV_BYTES,
  VAULT_KEK_BYTES,
  VAULT_SALT_BYTES,
  decryptVaultKey,
  deriveVaultKek,
  encryptVaultKey,
  encryptVaultKeyRecord,
  generateVaultIv,
  generateVaultSalt,
} from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url, validateVaultEnvelope } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';

const v = vectors.vault;
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('vault per-key crypto fixed vectors', () => {
  let kek: Uint8Array<ArrayBuffer>;
  let wrongKek: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    kek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    wrongKek = await deriveVaultKek('wrong-password-123456', decodeBase64Url(v.salt));
  }, 30000);

  it('recomputes the shared PBKDF2-HMAC-SHA-256/600k KEK', () => {
    expect(toHex(kek)).toBe(v.kekHex);
    expect(kek).toHaveLength(VAULT_KEK_BYTES);
    expect(toHex(wrongKek)).not.toBe(v.kekHex);
  });

  it.each(v.keys.map((key, index) => [index, key] as const))(
    'recomputes and decrypts key %i independently',
    async (_index, keyVector) => {
      const iv = decodeBase64Url(keyVector.iv);
      const ciphertext = await encryptVaultKey(kek, iv, keyVector.privateKey);
      expect(encodeBase64Url(ciphertext)).toBe(keyVector.ciphertext);
      expect(ciphertext).toHaveLength(keyVector.ciphertextBytes);
      expect(new TextEncoder().encode(keyVector.privateKey)).toHaveLength(keyVector.plaintextBytes);
      await expect(
        decryptVaultKey(kek, iv, decodeBase64Url(keyVector.ciphertext)),
      ).resolves.toBe(keyVector.privateKey);
    },
  );

  it('uses different IVs and ciphertexts for two WIFs under one KEK', () => {
    expect(v.keys).toHaveLength(2);
    expect(v.keys[0]?.iv).not.toBe(v.keys[1]?.iv);
    expect(v.keys[0]?.ciphertext).not.toBe(v.keys[1]?.ciphertext);
    expect(validateVaultEnvelope(v.envelope)).toEqual(v.envelope);
  });

  it('reencrypts the same WIF under a fresh IV with the exact vector', async () => {
    const first = v.keys[0];
    if (!first) throw new Error('missing first key vector');
    const ciphertext = await encryptVaultKey(
      kek,
      decodeBase64Url(v.reencryption.iv),
      first.privateKey,
    );
    expect(encodeBase64Url(ciphertext)).toBe(v.reencryption.ciphertext);
    expect(v.reencryption.iv).not.toBe(first.iv);
    expect(v.reencryption.ciphertext).not.toBe(first.ciphertext);
  });

  it('rejects a wrong password, tampering and a wrong AAD', async () => {
    const first = v.keys[0];
    if (!first) throw new Error('missing first key vector');
    const iv = decodeBase64Url(first.iv);
    const ciphertext = decodeBase64Url(first.ciphertext);
    await expect(decryptVaultKey(wrongKek, iv, ciphertext)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    const tampered = ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    await expect(decryptVaultKey(kek, iv, tampered)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    await expect(
      decryptVaultKey(kek, iv, ciphertext, 'steem-wallet.vault.v2'),
    ).rejects.toMatchObject({ code: 'VAULT_PASSWORD_INVALID' });
    const wrongAad = await encryptVaultKey(kek, iv, first.privateKey, 'steem-wallet.vault.v2');
    await expect(decryptVaultKey(kek, iv, wrongAad)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    await expect(decryptVaultKey(kek, iv, ciphertext)).resolves.toBe(first.privateKey);
  });

  it('generates fresh IVs for each new key and excludes the old IV on reencryption', async () => {
    const first = v.keys[0];
    const second = v.keys[1];
    if (!first || !second) throw new Error('missing key vectors');
    const one = await encryptVaultKeyRecord(kek, first.privateKey, 'one', [first.iv, second.iv]);
    const two = await encryptVaultKeyRecord(kek, second.privateKey, 'two', [first.iv, second.iv, one.iv]);
    expect(one.iv).not.toBe(two.iv);
    expect([first.iv, second.iv]).not.toContain(one.iv);
    expect([first.iv, second.iv, one.iv]).not.toContain(two.iv);
    await expect(
      decryptVaultKey(kek, decodeBase64Url(one.iv), decodeBase64Url(one.ciphertext)),
    ).resolves.toBe(first.privateKey);
  });

  it('accepts an empty vault without root IV or ciphertext', () => {
    expect(validateVaultEnvelope(v.emptyEnvelope)).toEqual(v.emptyEnvelope);
    expect(v.emptyEnvelope).not.toHaveProperty('iv');
    expect(v.emptyEnvelope).not.toHaveProperty('ciphertext');
  });

  it('generates random values of the required sizes', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(generateVaultSalt()).toHaveLength(VAULT_SALT_BYTES);
      expect(generateVaultIv()).toHaveLength(VAULT_IV_BYTES);
      expect(encodeBase64Url(generateVaultIv())).not.toBe(encodeBase64Url(generateVaultIv()));
    }
  });
});

describe('vault per-key crypto argument and availability contracts', () => {
  it('validates password, salt, KEK, IV and plaintext arguments', async () => {
    await expect(deriveVaultKek('', new Uint8Array(VAULT_SALT_BYTES))).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    await expect(deriveVaultKek('pw', new Uint8Array(VAULT_SALT_BYTES - 1))).rejects.toMatchObject({
      code: 'VAULT_ENVELOPE_INVALID',
    });
    await expect(
      encryptVaultKey(new Uint8Array(VAULT_KEK_BYTES - 1), new Uint8Array(VAULT_IV_BYTES), 'x'),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      encryptVaultKey(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES), ''),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      decryptVaultKey(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES - 1), new Uint8Array(16)),
    ).rejects.toBeInstanceOf(TypeError);
  });

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const subtle = globalThis.crypto.subtle;
  afterEach(() => {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
  });

  it('fails closed when subtle or randomness is unavailable', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(1) },
      configurable: true,
    });
    await expect(deriveVaultKek('pw', new Uint8Array(VAULT_SALT_BYTES))).rejects.toBeInstanceOf(
      VaultError,
    );
    await expect(
      encryptVaultKey(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES), 'x'),
    ).rejects.toMatchObject({ code: 'VAULT_CRYPTO_UNAVAILABLE' });
    expect(generateVaultSalt()).toHaveLength(VAULT_SALT_BYTES);
    Object.defineProperty(globalThis, 'crypto', { value: { subtle }, configurable: true });
    expect(() => generateVaultIv()).toThrow(VaultError);
    expect(() => generateVaultSalt()).toThrow(VaultError);
  });
});
