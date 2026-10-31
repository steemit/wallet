// Vault envelope and payload validation (A1).
//
// Pure structural validation — this module never touches Web Crypto (see
// ./crypto.ts). Everything is fail-closed: an unknown version, a malformed
// field or an off-spec length rejects with `VaultError` instead of attempting
// a lenient parse. Error messages describe WHAT is wrong and never echo field
// values — no ciphertext, salt, password or key material ever appears in a
// message.
import { VaultError } from './errors';
import type { VaultEnvelopeV1, VaultKeyRole, VaultPayloadV1 } from './types';

/** Exactly the five fields a V1 envelope (and therefore a backup) carries. */
const ENVELOPE_FIELDS = ['version', 'vaultName', 'salt', 'iv', 'ciphertext'] as const;

/** Exactly the three fields a payload key entry carries. */
const PAYLOAD_ENTRY_FIELDS = ['accountName', 'role', 'privateKey'] as const;

/** Legal key roles inside a stored payload. */
const VAULT_KEY_ROLES: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

/**
 * V1 salt length in bytes. Must match `VAULT_SALT_BYTES` in ./crypto.ts and
 * the test-vector fixture (16 bytes).
 */
export const VAULT_ENVELOPE_SALT_BYTES = 16;

/**
 * V1 IV length in bytes — the standard GCM nonce size. Must match
 * `VAULT_IV_BYTES` in ./crypto.ts (12 bytes).
 */
export const VAULT_ENVELOPE_IV_BYTES = 12;

/**
 * Minimum decoded ciphertext length: AES-GCM always appends a 16-byte
 * authentication tag, so anything shorter cannot be a valid V1 envelope.
 */
export const VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES = 16;

/**
 * Maximum decoded ciphertext length (1 MiB). Chosen far above the realistic
 * needs of a multi-account, multi-key vault payload, while defending against
 * memory amplification: without a cap, validation would decode and allocate
 * an arbitrarily large attacker-supplied field before any length check runs.
 */
export const VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES = 1 * 1024 * 1024;

/** Upper bound for a user-chosen vault display name. */
export const VAULT_ENVELOPE_NAME_MAX_LENGTH = 64;

/** Unpadded base64url alphabet (RFC 4648 §5): A-Z a-z 0-9 - _ — never '+' '/' '='. */
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Any string consisting solely of base64url alphabet characters. */
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

/** Reverse lookup table: ASCII code -> 6-bit value (-1 = not in the alphabet). */
const BASE64URL_LOOKUP = (() => {
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64URL_ALPHABET.length; i += 1) {
    lookup[BASE64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return lookup;
})();

/**
 * Encode bytes as unpadded base64url (RFC 4648 §5; never '=' padded, never
 * '+' or '/'). Empty input encodes as the empty string. This is the only
 * encoding envelope fields may use.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const byte0 = bytes[i] ?? 0;
    const byte1 = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const byte2 = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    out += BASE64URL_ALPHABET.charAt(byte0 >> 2);
    out += BASE64URL_ALPHABET.charAt(((byte0 & 0x03) << 4) | (byte1 >> 4));
    if (i + 1 < bytes.length) {
      out += BASE64URL_ALPHABET.charAt(((byte1 & 0x0f) << 2) | (byte2 >> 6));
    }
    if (i + 2 < bytes.length) {
      out += BASE64URL_ALPHABET.charAt(byte2 & 0x3f);
    }
  }
  return out;
}

/**
 * Decode unpadded base64url to bytes. Throws on any character outside the
 * base64url alphabet (including '+', '/' and '=' padding), on non-string
 * input, and on impossible lengths (`length % 4 === 1` — a lone trailing
 * 6-bit group cannot form a whole byte). The empty string decodes to zero
 * bytes; envelope field checks reject that separately via length rules.
 *
 * Returns a plain `ArrayBuffer`-backed array (Web Crypto `BufferSource`
 * compatible).
 */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !BASE64URL_RE.test(value)) {
    throw new Error('value is not unpadded base64url');
  }
  if (value.length % 4 === 1) {
    throw new Error('unpadded base64url length is impossible');
  }
  const out = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const sextet = code < 128 ? BASE64URL_LOOKUP[code] ?? -1 : -1;
    if (sextet < 0) {
      // Unreachable after the regex guard; kept as defense in depth.
      throw new Error('value contains a character outside the base64url alphabet');
    }
    buffer = (buffer << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}

function envelopeInvalid(reason: string): VaultError {
  return new VaultError('VAULT_ENVELOPE_INVALID', `vault envelope rejected: ${reason}`);
}

/**
 * Decode one base64url envelope field and enforce its decoded byte length.
 * Charset/padding errors are converted into envelope rejections so callers
 * only ever see `VaultError`. Never echoes the field value.
 */
function requireDecodedLength(
  field: 'salt' | 'iv' | 'ciphertext',
  value: unknown,
  minBytes: number,
  maxBytes: number,
): void {
  if (typeof value !== 'string') {
    throw envelopeInvalid(`${field} must be an unpadded base64url string`);
  }
  let decoded: Uint8Array;
  try {
    decoded = decodeBase64Url(value);
  } catch {
    throw envelopeInvalid(
      `${field} must be unpadded base64url without padding or illegal characters`,
    );
  }
  if (decoded.length < minBytes || decoded.length > maxBytes) {
    if (minBytes === maxBytes) {
      throw envelopeInvalid(`${field} must decode to exactly ${minBytes} bytes`);
    }
    if (decoded.length < minBytes) {
      throw envelopeInvalid(`${field} must decode to at least ${minBytes} bytes`);
    }
    throw envelopeInvalid(`${field} must decode to at most ${maxBytes} bytes`);
  }
}

/**
 * Validate an unknown value as a `VaultEnvelopeV1` (fail closed).
 *
 * Accepts exactly the five V1 fields with: `version === 1` (any other value
 * is an unknown version and rejects rather than attempting a lenient parse),
 * a non-empty `vaultName` within the length cap, a 16-byte `salt`, a 12-byte
 * `iv` and a `ciphertext` decoding to between 16 bytes (the GCM tag floor)
 * and `VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES`, all as unpadded base64url.
 * Returns a fresh, plain envelope object. Throws
 * `VaultError('VAULT_ENVELOPE_INVALID')` on any violation — with messages
 * that never contain the field values.
 */
export function validateVaultEnvelope(envelope: unknown): VaultEnvelopeV1 {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw envelopeInvalid('expected a plain object');
  }
  const record = envelope as Record<string, unknown>;
  const fieldNames = Object.keys(record).sort();
  const expectedNames = [...ENVELOPE_FIELDS].sort();
  if (
    fieldNames.length !== expectedNames.length ||
    expectedNames.some((field, i) => fieldNames[i] !== field)
  ) {
    throw envelopeInvalid(
      'expected exactly the five V1 fields: version, vaultName, salt, iv, ciphertext',
    );
  }
  if (record['version'] !== 1) {
    throw envelopeInvalid('unsupported version; only version 1 is accepted');
  }
  const { vaultName, salt, iv, ciphertext } = record;
  if (
    typeof vaultName !== 'string' ||
    vaultName.length < 1 ||
    vaultName.length > VAULT_ENVELOPE_NAME_MAX_LENGTH
  ) {
    throw envelopeInvalid(
      `vaultName must be a non-empty string of at most ${VAULT_ENVELOPE_NAME_MAX_LENGTH} characters`,
    );
  }
  requireDecodedLength('salt', salt, VAULT_ENVELOPE_SALT_BYTES, VAULT_ENVELOPE_SALT_BYTES);
  requireDecodedLength('iv', iv, VAULT_ENVELOPE_IV_BYTES, VAULT_ENVELOPE_IV_BYTES);
  // The ciphertext cap bounds only the encrypted layer. The A3 backup import
  // path must still enforce its own payload-level limits (number of keys,
  // overall backup size); envelope validation never sees the plaintext.
  requireDecodedLength(
    'ciphertext',
    ciphertext,
    VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES,
    VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES,
  );
  // Return a fresh plain object: never hand back a caller-controlled
  // prototype/getters under the validated type.
  return {
    version: 1,
    vaultName,
    salt: salt as string,
    iv: iv as string,
    ciphertext: ciphertext as string,
  };
}

function payloadInvalid(reason: string): VaultError {
  return new VaultError('VAULT_PAYLOAD_INVALID', `vault payload rejected: ${reason}`);
}

/**
 * Validate decrypted payload text as a `VaultPayloadV1` (fail closed).
 *
 * The text must parse as JSON into exactly `{ "keys": [...] }`; every entry
 * must be an object with exactly `accountName`, `role` and `privateKey`, all
 * non-empty strings, with `role` one of `owner | active | posting | memo`.
 * Throws `VaultError('VAULT_PAYLOAD_INVALID')` on any violation — with
 * messages that never contain payload content (no WIFs, no account names).
 */
export function validateVaultPayloadText(payloadText: string): VaultPayloadV1 {
  if (typeof payloadText !== 'string') {
    throw payloadInvalid('payload text must be a string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw payloadInvalid('payload text is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw payloadInvalid('payload must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const fieldNames = Object.keys(record);
  if (fieldNames.length !== 1 || fieldNames[0] !== 'keys' || !Array.isArray(record['keys'])) {
    throw payloadInvalid('payload must be exactly { "keys": [...] }');
  }
  const entries: unknown[] = record['keys'];
  const expectedEntryNames = [...PAYLOAD_ENTRY_FIELDS].sort();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw payloadInvalid('every key entry must be an object');
    }
    const entryRecord = entry as Record<string, unknown>;
    const entryFieldNames = Object.keys(entryRecord).sort();
    if (
      entryFieldNames.length !== expectedEntryNames.length ||
      expectedEntryNames.some((field, i) => entryFieldNames[i] !== field)
    ) {
      throw payloadInvalid(
        `every key entry must have exactly the fields ${PAYLOAD_ENTRY_FIELDS.join(', ')}`,
      );
    }
    for (const field of PAYLOAD_ENTRY_FIELDS) {
      if (typeof entryRecord[field] !== 'string' || entryRecord[field] === '') {
        throw payloadInvalid(`key entry field ${field} must be a non-empty string`);
      }
    }
    if (!VAULT_KEY_ROLES.includes(entryRecord['role'] as VaultKeyRole)) {
      throw payloadInvalid('key entry role must be one of: owner, active, posting, memo');
    }
  }
  return record as unknown as VaultPayloadV1;
}
