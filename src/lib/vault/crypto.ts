import { encodeBase64Url } from './envelope';
import { VaultError } from './errors';
import type { VaultKeyCiphertext } from './types';

export const VAULT_KDF_ITERATIONS = 600000;
export const VAULT_SALT_BYTES = 16;
export const VAULT_IV_BYTES = 12;
export const VAULT_KEK_BYTES = 32;
export const VAULT_AAD = 'steem-wallet.vault.v1';

function requireSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new VaultError(
      'VAULT_CRYPTO_UNAVAILABLE',
      'Web Crypto subtle API is unavailable in this environment',
    );
  }
  return subtle;
}

function requireRandom(): Crypto {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') {
    throw new VaultError(
      'VAULT_CRYPTO_UNAVAILABLE',
      'Web Crypto random generator is unavailable in this environment',
    );
  }
  return webCrypto;
}

function requireKek(kek: Uint8Array<ArrayBuffer>): void {
  if (kek.length !== VAULT_KEK_BYTES) {
    throw new TypeError(`vault KEK must be exactly ${VAULT_KEK_BYTES} bytes`);
  }
}

function requireIv(iv: Uint8Array<ArrayBuffer>): void {
  if (iv.length !== VAULT_IV_BYTES) {
    throw new TypeError(`vault IV must be exactly ${VAULT_IV_BYTES} bytes`);
  }
}

export async function deriveVaultKek(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new VaultError('VAULT_PASSWORD_INVALID', 'vault password must be a non-empty string');
  }
  if (typeof salt !== 'object' || salt === null || salt.length !== VAULT_SALT_BYTES) {
    throw new VaultError(
      'VAULT_ENVELOPE_INVALID',
      `vault salt must be exactly ${VAULT_SALT_BYTES} bytes`,
    );
  }
  const subtle = requireSubtle();
  const passwordKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_KDF_ITERATIONS },
    passwordKey,
    VAULT_KEK_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Encrypt exactly one WIF; the IV is always supplied explicitly for fixed vectors. */
export async function encryptVaultKey(
  kek: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  privateKey: string,
  aad: string = VAULT_AAD,
): Promise<Uint8Array<ArrayBuffer>> {
  requireKek(kek);
  requireIv(iv);
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw new TypeError('vault private key must be a non-empty string');
  }
  const subtle = requireSubtle();
  const key = await subtle.importKey('raw', kek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(privateKey),
  );
  return new Uint8Array(ciphertext);
}

/** Decrypt exactly one WIF; authentication failures deliberately share one error. */
export async function decryptVaultKey(
  kek: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>,
  aad: string = VAULT_AAD,
): Promise<string> {
  requireKek(kek);
  requireIv(iv);
  const subtle = requireSubtle();
  const key = await subtle.importKey('raw', kek, 'AES-GCM', false, ['decrypt']);
  try {
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new VaultError(
      'VAULT_PASSWORD_INVALID',
      'vault key decryption failed the authentication check',
    );
  }
}

export function generateVaultSalt(): Uint8Array<ArrayBuffer> {
  return requireRandom().getRandomValues(new Uint8Array(VAULT_SALT_BYTES));
}

export function generateVaultIv(): Uint8Array<ArrayBuffer> {
  return requireRandom().getRandomValues(new Uint8Array(VAULT_IV_BYTES));
}

/** Seal one key with a random IV that is new for this vault operation. */
export async function encryptVaultKeyRecord(
  kek: Uint8Array<ArrayBuffer>,
  privateKey: string,
  note: string,
  excludedIvs: readonly string[] = [],
): Promise<VaultKeyCiphertext> {
  let iv = generateVaultIv();
  while (excludedIvs.includes(encodeBase64Url(iv))) {
    iv = generateVaultIv();
  }
  const ciphertext = await encryptVaultKey(kek, iv, privateKey);
  return { iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(ciphertext), note };
}
