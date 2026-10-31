// Vault cryptography primitives (A1) — PBKDF2 key derivation and AES-GCM
// whole-envelope encryption using the browser Web Crypto API only. No new
// runtime dependencies.
//
// Cryptography profile, fixed by the checked-in test-vector fixture
// (tests/fixtures/vault-development-test-vectors.json, `meta` node) and the
// vault development kickoff §3.1 — do not change unilaterally:
//   - KEK:    PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte salt, 32-byte output
//   - Cipher: AES-GCM-256, 12-byte IV; ciphertext = encrypted bytes || 16-byte tag
//   - AAD:    'steem-wallet.vault.v1' binds every envelope to the wallet domain
//
// Fail-closed contract:
//   - `crypto.subtle` unavailable → `VaultError('VAULT_CRYPTO_UNAVAILABLE')`
//   - GCM authentication failure (wrong password / tampered ciphertext /
//     wrong AAD — indistinguishable by design) → `VaultError('VAULT_PASSWORD_INVALID')`
//
// SENSITIVE: KEK bytes and plaintext exist only inside function scopes,
// return values and (from A2 on) the vault service closure. They are never
// logged and never embedded in error messages.
import { VaultError } from './errors';

/** PBKDF2 iteration count — fixed by the fixture `meta.kdf.iterations`. */
export const VAULT_KDF_ITERATIONS = 600000;

/** Salt length in bytes. Must match envelope validation (./envelope.ts). */
export const VAULT_SALT_BYTES = 16;

/** GCM nonce length in bytes. Must match envelope validation (./envelope.ts). */
export const VAULT_IV_BYTES = 12;

/** KEK length in bytes (AES-256 key material). */
export const VAULT_KEK_BYTES = 32;

/** GCM authentication-tag length in bytes (appended to the ciphertext). */
export const VAULT_GCM_TAG_BYTES = 16;

/**
 * Additional authenticated data binding every V1 envelope to the Steem
 * Wallet domain. Matches the fixture `meta.vaultAad`; exported so tests and
 * A2/A3 reuse the constant instead of re-typing the literal.
 */
export const VAULT_AAD = 'steem-wallet.vault.v1';

/**
 * Return `crypto.subtle`, failing closed (`VAULT_CRYPTO_UNAVAILABLE`) when
 * the SubtleCrypto API is missing — old browsers, insecure contexts or
 * hardened environments. Read at call time so unavailability is always
 * detected on the current environment, never on import time.
 */
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

/**
 * Return the Crypto object backing `getRandomValues`, failing closed
 * (`VAULT_CRYPTO_UNAVAILABLE`) when randomness is unavailable.
 */
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

/** KEK argument contract: always 32 bytes (AES-256). Programmer error otherwise. */
function requireKek(kek: Uint8Array<ArrayBuffer>): void {
  if (kek.length !== VAULT_KEK_BYTES) {
    throw new TypeError(`vault KEK must be exactly ${VAULT_KEK_BYTES} bytes`);
  }
}

/** IV argument contract: always 12 bytes (GCM nonce). Programmer error otherwise. */
function requireIv(iv: Uint8Array<ArrayBuffer>): void {
  if (iv.length !== VAULT_IV_BYTES) {
    throw new TypeError(`vault IV must be exactly ${VAULT_IV_BYTES} bytes`);
  }
}

/**
 * Derive the 32-byte key-encryption key (KEK) from the user's vault password
 * with PBKDF2-HMAC-SHA-256 (600,000 iterations, fixture-fixed parameters).
 *
 * The returned KEK is SENSITIVE: keep it in the caller's scope (from A2 on,
 * the vault service closure), never in Redux, logs or error messages. An
 * empty password or a wrong-length salt fails closed before any Web Crypto
 * call.
 */
export async function deriveVaultKek(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new VaultError('VAULT_PASSWORD_INVALID', 'vault password must be a non-empty string');
  }
  if (typeof salt !== 'object' || salt === null || salt.length !== VAULT_SALT_BYTES) {
    throw new VaultError('VAULT_ENVELOPE_INVALID', `vault salt must be exactly ${VAULT_SALT_BYTES} bytes`);
  }
  const subtle = requireSubtle();
  const passwordKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const kekBits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: VAULT_KDF_ITERATIONS },
    passwordKey,
    VAULT_KEK_BYTES * 8,
  );
  return new Uint8Array(kekBits);
}

/**
 * Encrypt the payload JSON text (UTF-8) whole-bucket with AES-GCM-256.
 * Returns ciphertext with the 16-byte GCM tag appended (Web Crypto's native
 * output format). Deterministic for identical (kek, iv, plaintext, aad) —
 * freshness comes from the caller generating a new IV (see
 * {@link generateVaultIv}), never from the cipher itself.
 *
 * The default AAD is {@link VAULT_AAD}; the parameter exists for versioned
 * AAD rotation and negative testing. See ./envelope.ts for the base64url
 * encoding used by envelope fields.
 */
export async function encryptVaultText(
  kek: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  plaintext: string,
  aad: string = VAULT_AAD,
): Promise<Uint8Array<ArrayBuffer>> {
  requireKek(kek);
  requireIv(iv);
  const subtle = requireSubtle();
  const key = await subtle.importKey('raw', kek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return new Uint8Array(ciphertext);
}

/**
 * Decrypt a whole-bucket AES-GCM-256 ciphertext (tag appended) back to the
 * payload JSON text. Any authentication failure — wrong password (KEK),
 * tampered ciphertext or wrong AAD, which GCM deliberately does not
 * distinguish — fails closed as `VaultError('VAULT_PASSWORD_INVALID')`.
 *
 * The default AAD is {@link VAULT_AAD}; see {@link encryptVaultText}.
 * Ciphertext length is not re-checked here: envelope validation
 * (./envelope.ts) already rejects anything shorter than the GCM tag.
 */
export async function decryptVaultText(
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
    // GCM cannot tell wrong key, tampering and wrong AAD apart; expose a
    // single password-invalid failure and never leak decrypted material.
    throw new VaultError('VAULT_PASSWORD_INVALID', 'vault decryption failed the authentication check');
  }
}

/**
 * Generate a fresh 16-byte envelope salt from the platform CSPRNG. A new
 * salt (i.e. a new KEK) is only needed when a vault is created or its
 * password changes — not for ordinary re-encryption.
 */
export function generateVaultSalt(): Uint8Array<ArrayBuffer> {
  return requireRandom().getRandomValues(new Uint8Array(VAULT_SALT_BYTES));
}

/**
 * Generate a fresh 12-byte GCM IV from the platform CSPRNG. Every encryption
 * of a modified payload must use a new IV; re-encrypting unchanged payload
 * bytes with the same IV is intentionally identical (see the fixture
 * `reencryption` vector).
 */
export function generateVaultIv(): Uint8Array<ArrayBuffer> {
  return requireRandom().getRandomValues(new Uint8Array(VAULT_IV_BYTES));
}
