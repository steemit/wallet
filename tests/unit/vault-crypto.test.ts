// Vault crypto tests (A1). The checked-in fixed vectors are RECOMPUTED with
// Web Crypto and compared byte-for-byte / character-for-character, per the
// kickoff §3.1 requirement — never mere re-assertions of the fixture's
// boolean flags. All WIFs/passwords here are public test-only data.
//
// Performance: PBKDF2 at 600k iterations costs hundreds of milliseconds per
// call. Both KEKs (correct + wrong password) are derived ONCE in beforeAll
// and shared across the describe block; only the focused KEK test pays for
// one extra derivation. Do not move derivations into individual `it` blocks.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import vectors from '../fixtures/vault-development-test-vectors.json';
import {
  VAULT_IV_BYTES,
  VAULT_KEK_BYTES,
  VAULT_SALT_BYTES,
  decryptVaultText,
  deriveVaultKek,
  encryptVaultText,
  generateVaultIv,
  generateVaultSalt,
} from '@/lib/vault/crypto';
import { decodeBase64Url, encodeBase64Url, validateVaultPayloadText } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';

const v = vectors.vault;
const WRONG_PASSWORD = 'wrong-password-123456';
const WRONG_AAD = 'steem-wallet.vault.v2';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

describe('vault crypto — fixed vectors recomputed with Web Crypto', () => {
  const salt = decodeBase64Url(v.salt);
  const iv = decodeBase64Url(v.iv);
  const ciphertext = decodeBase64Url(v.ciphertext);
  let kek: Uint8Array<ArrayBuffer>;
  let wrongKek: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    kek = await deriveVaultKek(v.password, salt);
    wrongKek = await deriveVaultKek(WRONG_PASSWORD, salt);
  }, 30000);

  it('1. recomputes the fixture KEK via PBKDF2-HMAC-SHA-256 (600k iterations)', async () => {
    const recomputed = await deriveVaultKek(v.password, salt);
    expect(toHex(recomputed)).toBe(v.kekHex);
    expect(recomputed).toHaveLength(VAULT_KEK_BYTES);
  });

  it('1b. derives a different KEK for the wrong password', () => {
    expect(toHex(wrongKek)).not.toBe(v.kekHex);
  });

  it('2. encrypts payloadText to the exact fixture ciphertext', async () => {
    const ct = await encryptVaultText(kek, iv, v.payloadText);
    expect(encodeBase64Url(ct)).toBe(v.ciphertext);
    expect(ct).toHaveLength(v.ciphertextBytes);
    expect(utf8Bytes(v.payloadText)).toBe(v.plaintextBytes);
  });

  it('3. decrypts the fixture ciphertext back to payloadText and it validates', async () => {
    const plaintext = await decryptVaultText(kek, iv, ciphertext);
    expect(plaintext).toBe(v.payloadText);
    const payload = validateVaultPayloadText(plaintext);
    expect(payload.keys[0]?.accountName).toBe('alice');
    expect(payload.keys[0]?.role).toBe('posting');
  });

  it('4. rejects the wrong password with VAULT_PASSWORD_INVALID', async () => {
    await expect(decryptVaultText(wrongKek, iv, ciphertext)).rejects.toBeInstanceOf(VaultError);
    await expect(decryptVaultText(wrongKek, iv, ciphertext)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
  });

  it('5. rejects a tampered ciphertext copy without polluting the baseline vector', async () => {
    // Independent copy via slice() — never mutate the fixture-derived array.
    const tampered = new Uint8Array(ciphertext.slice());
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    await expect(decryptVaultText(kek, iv, tampered)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    // Baseline untouched: the original vector still decrypts cleanly.
    await expect(decryptVaultText(kek, iv, ciphertext)).resolves.toBe(v.payloadText);
    expect(ciphertext[0]).toBe(decodeBase64Url(v.ciphertext)[0]);
  });

  it('6. rejects a different AAD on both the decrypt and encrypt sides', async () => {
    // Decrypting the fixture ciphertext under a wrong AAD must fail.
    await expect(decryptVaultText(kek, iv, ciphertext, WRONG_AAD)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
    // A ciphertext produced under a wrong AAD cannot be opened with the
    // correct AAD either.
    const wrongAadCiphertext = await encryptVaultText(kek, iv, v.payloadText, WRONG_AAD);
    expect(encodeBase64Url(wrongAadCiphertext)).not.toBe(v.ciphertext);
    await expect(decryptVaultText(kek, iv, wrongAadCiphertext)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
  });

  it('7. reproduces the reencryption vector: new IV ⇒ new ciphertext', async () => {
    const reencIv = decodeBase64Url(v.reencryption.iv);
    const ct = await encryptVaultText(kek, reencIv, v.payloadText);
    expect(encodeBase64Url(ct)).toBe(v.reencryption.ciphertext);
    expect(encodeBase64Url(ct)).not.toBe(v.ciphertext);
    // ...and it round-trips under its own IV.
    await expect(decryptVaultText(kek, reencIv, ct)).resolves.toBe(v.payloadText);
  });

  it('8. covers the empty-payload vector ({"keys":[]})', async () => {
    const emptyIv = decodeBase64Url(v.emptyPayload.iv);
    const ct = await encryptVaultText(kek, emptyIv, v.emptyPayload.payloadText);
    expect(encodeBase64Url(ct)).toBe(v.emptyPayload.ciphertext);
    const plaintext = await decryptVaultText(
      kek,
      emptyIv,
      decodeBase64Url(v.emptyPayload.ciphertext),
    );
    expect(plaintext).toBe(v.emptyPayload.payloadText);
    expect(validateVaultPayloadText(plaintext)).toEqual({ keys: [] });
  });

  it('9. generates correctly sized, non-repeating salts and IVs', () => {
    for (let i = 0; i < 5; i += 1) {
      const saltA = generateVaultSalt();
      const saltB = generateVaultSalt();
      expect(saltA).toHaveLength(VAULT_SALT_BYTES);
      expect(saltB).toHaveLength(VAULT_SALT_BYTES);
      expect(encodeBase64Url(saltA)).not.toBe(encodeBase64Url(saltB));

      const ivA = generateVaultIv();
      const ivB = generateVaultIv();
      expect(ivA).toHaveLength(VAULT_IV_BYTES);
      expect(ivB).toHaveLength(VAULT_IV_BYTES);
      expect(encodeBase64Url(ivA)).not.toBe(encodeBase64Url(ivB));
    }
  });

  // A2 semantics this pins down: unlocking and locking without a payload
  // modification leaves the stored envelope unchanged (same salt, IV and
  // ciphertext — AES-GCM is deterministic for a fixed (key, IV, AAD,plaintext));
  // any payload modification must rotate the IV and therefore the ciphertext.
  it('10. deterministic for identical inputs; a fresh IV changes the ciphertext', async () => {
    // Unlock → lock → re-encrypt the SAME payload with the SAME salt+IV:
    // the envelope fields stay byte-identical (no rewrite needed).
    const first = encodeBase64Url(await encryptVaultText(kek, iv, v.payloadText));
    const second = encodeBase64Url(await encryptVaultText(kek, iv, v.payloadText));
    expect(second).toBe(first);
    expect(first).toBe(v.ciphertext);

    // Modified payload + freshly generated random IV ⇒ different ciphertext.
    const modifiedPayloadText = JSON.stringify({
      keys: [
        ...validateVaultPayloadText(v.payloadText).keys,
        { accountName: 'bob', role: 'active', privateKey: '5Jtest-wif-not-real' },
      ],
    });
    const freshIv = generateVaultIv();
    const rewritten = encodeBase64Url(await encryptVaultText(kek, freshIv, modifiedPayloadText));
    expect(freshIv).toHaveLength(VAULT_IV_BYTES);
    expect(rewritten).not.toBe(v.ciphertext);
    // ...and the rewritten envelope decrypts back under the fresh IV.
    await expect(decryptVaultText(kek, freshIv, decodeBase64Url(rewritten))).resolves.toBe(
      modifiedPayloadText,
    );
  });
});

describe('vault crypto argument contracts (fail closed before any Web Crypto call)', () => {
  it('rejects an empty password with VAULT_PASSWORD_INVALID', async () => {
    await expect(deriveVaultKek('', new Uint8Array(VAULT_SALT_BYTES))).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_INVALID',
    });
  });

  it('rejects a wrong-length salt with VAULT_ENVELOPE_INVALID', async () => {
    await expect(deriveVaultKek('pw', new Uint8Array(VAULT_SALT_BYTES - 1))).rejects.toMatchObject({
      code: 'VAULT_ENVELOPE_INVALID',
    });
  });

  it('rejects wrong-length KEK/IV arguments with TypeError', async () => {
    await expect(
      encryptVaultText(new Uint8Array(VAULT_KEK_BYTES - 1), new Uint8Array(VAULT_IV_BYTES), 'x'),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      encryptVaultText(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES - 1), 'x'),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      decryptVaultText(new Uint8Array(VAULT_KEK_BYTES - 1), new Uint8Array(VAULT_IV_BYTES), new Uint8Array(16)),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      decryptVaultText(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES - 1), new Uint8Array(16)),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('vault crypto without Web Crypto (fail closed)', () => {
  // jsdom installs `crypto` as a configurable getter on globalThis; capture
  // the original descriptor so each test can be reverted exactly.
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalSubtle = globalThis.crypto.subtle;

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
    }
  });

  it('subtle operations throw VAULT_CRYPTO_UNAVAILABLE when subtle is missing', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(0);
          return array;
        },
      },
      writable: true,
      configurable: true,
    });
    await expect(deriveVaultKek('pw', new Uint8Array(VAULT_SALT_BYTES))).rejects.toBeInstanceOf(
      VaultError,
    );
    await expect(
      deriveVaultKek('pw', new Uint8Array(VAULT_SALT_BYTES)),
    ).rejects.toMatchObject({ code: 'VAULT_CRYPTO_UNAVAILABLE' });
    await expect(
      encryptVaultText(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES), 'x'),
    ).rejects.toMatchObject({ code: 'VAULT_CRYPTO_UNAVAILABLE' });
    await expect(
      decryptVaultText(new Uint8Array(VAULT_KEK_BYTES), new Uint8Array(VAULT_IV_BYTES), new Uint8Array(16)),
    ).rejects.toMatchObject({ code: 'VAULT_CRYPTO_UNAVAILABLE' });
    // Only getRandomValues is needed by the generators — they still work.
    expect(generateVaultSalt()).toHaveLength(VAULT_SALT_BYTES);
    expect(generateVaultIv()).toHaveLength(VAULT_IV_BYTES);
  });

  it('generators throw VAULT_CRYPTO_UNAVAILABLE when getRandomValues is missing', async () => {
    // subtle present, randomness absent.
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: originalSubtle },
      writable: true,
      configurable: true,
    });
    expect(() => generateVaultSalt()).toThrow(VaultError);
    expect(() => generateVaultIv()).toThrow(VaultError);
    try {
      generateVaultSalt();
      expect.unreachable('expected generateVaultSalt to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultError);
      expect(error).toMatchObject({ code: 'VAULT_CRYPTO_UNAVAILABLE' });
    }
    // Subtle-only operations keep working without getRandomValues.
    const kek = await deriveVaultKek(v.password, decodeBase64Url(v.salt));
    expect(toHex(kek)).toBe(v.kekHex);
  });
});
