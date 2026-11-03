// Vault envelope and payload validation (A1 + A1.1).
//
// Pure structural validation and resource bounds — this module never touches
// Web Crypto (see ./crypto.ts). Everything is fail-closed: an unknown version,
// a malformed field, an off-spec length, a non-canonical base64url encoding or
// a resource overage rejects with `VaultError` instead of attempting a lenient
// parse. Error messages describe WHAT is wrong and never echo field values —
// no ciphertext, salt, password or key material ever appears in a message.
import { normalizeSteemUsername } from '@/lib/steem/username';
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
 * Maximum decoded ciphertext length (1 MiB). A resource bound (exceeding it
 * throws `VAULT_LIMIT_EXCEEDED`), chosen far above the realistic needs of a
 * multi-account, multi-key vault payload while defending against memory
 * amplification. The encoded string is length-checked BEFORE decoding (see
 * {@link VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS}) so an oversized field is
 * rejected without first allocating its decoded bytes; what this cap then
 * guarantees is that every ACCEPTED envelope carries ≤ 1 MiB of ciphertext
 * into decryption.
 */
export const VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES = 1 * 1024 * 1024;

/**
 * Maximum base64url character length of the `ciphertext` field:
 * ceil(MAX_BYTES * 8 / 6). Longer strings cannot possibly decode to within
 * the byte cap, so they are rejected before any decode allocation happens.
 */
export const VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS = Math.ceil(
  (VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES * 8) / 6,
);

/**
 * Maximum UTF-8 byte length of the raw envelope JSON text accepted by
 * {@link parseVaultEnvelopeJson}, checked before `JSON.parse` runs. A
 * resource bound — exceeding it throws `VAULT_LIMIT_EXCEEDED`.
 */
export const VAULT_ENVELOPE_JSON_MAX_BYTES = 1 * 1024 * 1024;

/**
 * Maximum UTF-8 byte length of the decrypted payload text (1 MiB minus the
 * 16-byte GCM tag, so the resulting ciphertext always fits the envelope
 * ciphertext cap). Enforced in {@link validateVaultPayloadText}; exceeding it
 * throws `VAULT_LIMIT_EXCEEDED`.
 */
export const VAULT_PAYLOAD_MAX_UTF8_BYTES = 1 * 1024 * 1024 - 16;

/**
 * Maximum number of key entries a stored payload may carry. Resource bound —
 * exceeding it throws `VAULT_LIMIT_EXCEEDED`.
 */
export const VAULT_PAYLOAD_MAX_KEYS = 400;

/**
 * Maximum number of distinct normalized account names a stored payload may
 * carry. Resource bound — exceeding it throws `VAULT_LIMIT_EXCEEDED`.
 */
export const VAULT_PAYLOAD_MAX_ACCOUNTS = 100;

/**
 * Upper bound for a user-chosen vault display name, counted in Unicode code
 * points (not UTF-16 code units). This is only the loose envelope-level
 * structural bound; the full alias policy (NFC, forbidden categories, no
 * leading/trailing whitespace) lives in ./validation.ts and every
 * create/import/rename flow must go through it.
 */
export const VAULT_ENVELOPE_NAME_MAX_CODE_POINTS = 64;

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

function limitExceeded(reason: string): VaultError {
  return new VaultError('VAULT_LIMIT_EXCEEDED', `vault resource limit exceeded: ${reason}`);
}

/**
 * Decode one base64url envelope field and enforce canonical form: the value
 * must satisfy `encodeBase64Url(decodeBase64Url(value)) === value`. Non-zero
 * trailing bits (e.g. a 16-alias salt tail), '=' padding and illegal
 * characters all reject with `VAULT_ENVELOPE_INVALID` — there is exactly ONE
 * accepted encoding per byte sequence, so downstream string comparisons of
 * envelope fields are safe. Never echoes the field value.
 */
function decodeEnvelopeField(
  field: 'salt' | 'iv' | 'ciphertext',
  value: unknown,
): Uint8Array {
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
  if (encodeBase64Url(decoded) !== value) {
    throw envelopeInvalid(
      `${field} is not canonical base64url (non-zero trailing bits or padded form)`,
    );
  }
  return decoded;
}

/**
 * Validate an unknown value as a `VaultEnvelopeV1` (fail closed).
 *
 * Accepts exactly the five V1 fields with: `version === 1` (any other value
 * is an unknown version and rejects rather than attempting a lenient parse),
 * a non-empty `vaultName` of at most {@link VAULT_ENVELOPE_NAME_MAX_CODE_POINTS}
 * Unicode code points, a 16-byte `salt`, a 12-byte `iv` and a `ciphertext`
 * decoding to between 16 bytes (the GCM tag floor) and
 * `VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES` — all as CANONICAL unpadded base64url
 * (see {@link decodeEnvelopeField}). Returns a fresh, plain envelope object.
 *
 * Throws `VaultError('VAULT_ENVELOPE_INVALID')` for structural violations and
 * `VaultError('VAULT_LIMIT_EXCEEDED')` when the ciphertext exceeds the
 * resource cap — messages never contain the field values.
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
    [...vaultName].length > VAULT_ENVELOPE_NAME_MAX_CODE_POINTS
  ) {
    throw envelopeInvalid(
      `vaultName must be a non-empty string of at most ${VAULT_ENVELOPE_NAME_MAX_CODE_POINTS} Unicode code points`,
    );
  }
  const saltBytes = decodeEnvelopeField('salt', salt);
  if (saltBytes.length !== VAULT_ENVELOPE_SALT_BYTES) {
    throw envelopeInvalid(`salt must decode to exactly ${VAULT_ENVELOPE_SALT_BYTES} bytes`);
  }
  const ivBytes = decodeEnvelopeField('iv', iv);
  if (ivBytes.length !== VAULT_ENVELOPE_IV_BYTES) {
    throw envelopeInvalid(`iv must decode to exactly ${VAULT_ENVELOPE_IV_BYTES} bytes`);
  }
  // Resource pre-check on the ENCODED length before decoding, so an oversized
  // field is rejected without allocating its decoded bytes.
  if (typeof ciphertext !== 'string') {
    throw envelopeInvalid('ciphertext must be an unpadded base64url string');
  }
  if (ciphertext.length > VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS) {
    throw limitExceeded('ciphertext exceeds the maximum encoded length');
  }
  const ciphertextBytes = decodeEnvelopeField('ciphertext', ciphertext);
  if (ciphertextBytes.length < VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES) {
    throw envelopeInvalid(
      `ciphertext must decode to at least ${VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES} bytes`,
    );
  }
  if (ciphertextBytes.length > VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES) {
    throw limitExceeded('ciphertext exceeds the maximum decoded length');
  }
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

/**
 * Parse raw envelope JSON text into a validated `VaultEnvelopeV1` (fail
 * closed). This is THE entry point for import/backup paths that receive
 * envelope text: the raw string is resource-bounded to
 * {@link VAULT_ENVELOPE_JSON_MAX_BYTES} UTF-8 bytes BEFORE `JSON.parse` runs
 * (over the bound → `VAULT_LIMIT_EXCEEDED`), non-JSON text rejects with
 * `VAULT_ENVELOPE_INVALID`, and the parsed value then goes through the full
 * {@link validateVaultEnvelope} field validation. Never echoes the raw text.
 */
export function parseVaultEnvelopeJson(raw: string): VaultEnvelopeV1 {
  if (typeof raw !== 'string') {
    throw envelopeInvalid('envelope JSON input must be a string');
  }
  // Cheap UTF-16-unit proxy first (UTF-8 bytes are always >= code units for
  // any string TextEncoder accepts), then the exact byte count.
  if (raw.length > VAULT_ENVELOPE_JSON_MAX_BYTES) {
    throw limitExceeded('raw envelope JSON exceeds the maximum size');
  }
  if (new TextEncoder().encode(raw).length > VAULT_ENVELOPE_JSON_MAX_BYTES) {
    throw limitExceeded('raw envelope JSON exceeds the maximum size');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw envelopeInvalid('envelope text is not valid JSON');
  }
  return validateVaultEnvelope(parsed);
}

function payloadInvalid(reason: string): VaultError {
  return new VaultError('VAULT_PAYLOAD_INVALID', `vault payload rejected: ${reason}`);
}

/**
 * Validate decrypted payload text as a `VaultPayloadV1` (fail closed).
 *
 * Resource bounds first (all over-limit → `VAULT_LIMIT_EXCEEDED`): the text
 * may span at most {@link VAULT_PAYLOAD_MAX_UTF8_BYTES} UTF-8 bytes (checked
 * before `JSON.parse`), carry at most {@link VAULT_PAYLOAD_MAX_KEYS} key
 * entries and reference at most {@link VAULT_PAYLOAD_MAX_ACCOUNTS} distinct
 * accounts, counted after `normalizeSteemUsername`. These are the same
 * constants create/import paths must enforce — do not re-derive them at call
 * sites or only in the UI.
 *
 * Structure: the text must parse as JSON into exactly `{ "keys": [...] }`;
 * every entry must be an object with exactly `accountName`, `role` and
 * `privateKey`, all non-empty strings, with `role` one of
 * `owner | active | posting | memo`. Structural violations throw
 * `VaultError('VAULT_PAYLOAD_INVALID')` — messages never contain payload
 * content (no WIFs, no account names).
 */
export function validateVaultPayloadText(payloadText: string): VaultPayloadV1 {
  if (typeof payloadText !== 'string') {
    throw payloadInvalid('payload text must be a string');
  }
  // UTF-16-unit proxy first: UTF-8 bytes are always >= code units, so an
  // over-limit unit count rejects without encoding; the exact byte count
  // then catches multi-byte payloads that fit under the unit bound.
  if (payloadText.length > VAULT_PAYLOAD_MAX_UTF8_BYTES) {
    throw limitExceeded('payload text exceeds the maximum UTF-8 size');
  }
  if (new TextEncoder().encode(payloadText).length > VAULT_PAYLOAD_MAX_UTF8_BYTES) {
    throw limitExceeded('payload text exceeds the maximum UTF-8 size');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw payloadInvalid('payload text is not valid JSON');
  }
  return validateParsedPayload(parsed);
}

function validateParsedPayload(parsed: unknown): VaultPayloadV1 {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw payloadInvalid('payload must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const fieldNames = Object.keys(record);
  if (fieldNames.length !== 1 || fieldNames[0] !== 'keys' || !Array.isArray(record['keys'])) {
    throw payloadInvalid('payload must be exactly { "keys": [...] }');
  }
  const entries: unknown[] = record['keys'];
  if (entries.length > VAULT_PAYLOAD_MAX_KEYS) {
    throw limitExceeded(`payload carries more than ${VAULT_PAYLOAD_MAX_KEYS} key entries`);
  }
  const expectedEntryNames = [...PAYLOAD_ENTRY_FIELDS].sort();
  const accounts = new Set<string>();
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
    accounts.add(normalizeSteemUsername(entryRecord['accountName'] as string));
  }
  if (accounts.size > VAULT_PAYLOAD_MAX_ACCOUNTS) {
    throw limitExceeded(`payload references more than ${VAULT_PAYLOAD_MAX_ACCOUNTS} accounts`);
  }
  return record as unknown as VaultPayloadV1;
}
