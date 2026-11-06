import { isValidSteemUsernameFormat, normalizeSteemUsername } from '@/lib/steem/username';
import { VaultError } from './errors';
import type {
  VaultAccountEntry,
  VaultEnvelopeV1,
  VaultKeyCiphertext,
  VaultKeyRole,
  VaultRoleKeys,
} from './types';

const ENVELOPE_FIELDS = ['version', 'vaultName', 'salt', 'accounts'] as const;
const ACCOUNT_FIELDS = ['accountName', 'keys'] as const;
const KEY_FIELDS = ['iv', 'ciphertext', 'note'] as const;

export const VAULT_KEY_ROLES: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];
export const VAULT_ENVELOPE_SALT_BYTES = 16;
export const VAULT_ENVELOPE_IV_BYTES = 12;
export const VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES = 16;
export const VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES = 1024 * 1024;
export const VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS = Math.ceil(
  (VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES * 8) / 6,
);
export const VAULT_ENVELOPE_JSON_MAX_BYTES = 1024 * 1024;
export const VAULT_ENVELOPE_MAX_KEYS = 400;
export const VAULT_ENVELOPE_MAX_ACCOUNTS = 100;
export const VAULT_ENVELOPE_NAME_MAX_CODE_POINTS = 64;

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const BASE64URL_LOOKUP = (() => {
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64URL_ALPHABET.length; i += 1) {
    lookup[BASE64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return lookup;
})();

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const byte0 = bytes[i] ?? 0;
    const byte1 = i + 1 < bytes.length ? bytes[i + 1] ?? 0 : 0;
    const byte2 = i + 2 < bytes.length ? bytes[i + 2] ?? 0 : 0;
    out += BASE64URL_ALPHABET.charAt(byte0 >> 2);
    out += BASE64URL_ALPHABET.charAt(((byte0 & 0x03) << 4) | (byte1 >> 4));
    if (i + 1 < bytes.length) out += BASE64URL_ALPHABET.charAt(((byte1 & 0x0f) << 2) | (byte2 >> 6));
    if (i + 2 < bytes.length) out += BASE64URL_ALPHABET.charAt(byte2 & 0x3f);
  }
  return out;
}

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
    if (sextet < 0) throw new Error('value contains a character outside the base64url alphabet');
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

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && expected.every((field, i) => actual[i] === field);
}

function decodeEnvelopeField(
  field: 'salt' | 'iv' | 'ciphertext',
  value: unknown,
): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string') {
    throw envelopeInvalid(`${field} must be an unpadded base64url string`);
  }
  let decoded: Uint8Array<ArrayBuffer>;
  try {
    decoded = decodeBase64Url(value);
  } catch {
    throw envelopeInvalid(`${field} must be canonical unpadded base64url`);
  }
  if (encodeBase64Url(decoded) !== value) {
    throw envelopeInvalid(`${field} is not canonical base64url`);
  }
  return decoded;
}

function validateKey(value: unknown, usedIvs: Set<string>): VaultKeyCiphertext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw envelopeInvalid('every encrypted key must be an object');
  }
  const record = value as Record<string, unknown>;
  if (!hasExactFields(record, KEY_FIELDS)) {
    throw envelopeInvalid('every encrypted key must have exactly iv, ciphertext and note');
  }
  const { iv, ciphertext, note } = record;
  const ivBytes = decodeEnvelopeField('iv', iv);
  if (ivBytes.length !== VAULT_ENVELOPE_IV_BYTES) {
    throw envelopeInvalid(`key IV must decode to exactly ${VAULT_ENVELOPE_IV_BYTES} bytes`);
  }
  if (usedIvs.has(iv as string)) {
    throw envelopeInvalid('key IVs must be unique within a vault');
  }
  usedIvs.add(iv as string);
  if (typeof ciphertext !== 'string') {
    throw envelopeInvalid('ciphertext must be an unpadded base64url string');
  }
  if (ciphertext.length > VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS) {
    throw limitExceeded('key ciphertext exceeds the maximum encoded length');
  }
  const ciphertextBytes = decodeEnvelopeField('ciphertext', ciphertext);
  if (ciphertextBytes.length < VAULT_ENVELOPE_CIPHERTEXT_MIN_BYTES) {
    throw envelopeInvalid('key ciphertext is shorter than the AES-GCM authentication tag');
  }
  if (ciphertextBytes.length > VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES) {
    throw limitExceeded('key ciphertext exceeds the maximum decoded length');
  }
  if (typeof note !== 'string') {
    throw envelopeInvalid('key note must be a string');
  }
  return { iv: iv as string, ciphertext, note };
}

function validateAccount(value: unknown, usedIvs: Set<string>): VaultAccountEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw envelopeInvalid('every account must be an object');
  }
  const record = value as Record<string, unknown>;
  if (!hasExactFields(record, ACCOUNT_FIELDS)) {
    throw envelopeInvalid('every account must have exactly accountName and keys');
  }
  const accountName = record['accountName'];
  if (
    typeof accountName !== 'string' ||
    !isValidSteemUsernameFormat(normalizeSteemUsername(accountName))
  ) {
    throw envelopeInvalid('accountName must be a valid Steem account name');
  }
  const keysValue = record['keys'];
  if (typeof keysValue !== 'object' || keysValue === null || Array.isArray(keysValue)) {
    throw envelopeInvalid('account keys must be an object with four roles');
  }
  const keysRecord = keysValue as Record<string, unknown>;
  if (!hasExactFields(keysRecord, VAULT_KEY_ROLES)) {
    throw envelopeInvalid('account keys must contain exactly owner, active, posting and memo');
  }
  const keys = {} as VaultRoleKeys;
  for (const role of VAULT_KEY_ROLES) {
    const entries = keysRecord[role];
    if (!Array.isArray(entries)) throw envelopeInvalid(`account ${role} keys must be an array`);
    keys[role] = entries.map((entry) => validateKey(entry, usedIvs));
  }
  return { accountName, keys };
}

export function validateVaultEnvelope(envelope: unknown): VaultEnvelopeV1 {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw envelopeInvalid('expected a plain object');
  }
  const record = envelope as Record<string, unknown>;
  if (!hasExactFields(record, ENVELOPE_FIELDS)) {
    throw envelopeInvalid('expected exactly version, vaultName, salt and accounts');
  }
  if (record['version'] !== 1) throw envelopeInvalid('only version 1 is accepted');
  const { vaultName, salt, accounts } = record;
  if (
    typeof vaultName !== 'string' ||
    vaultName.length === 0 ||
    [...vaultName].length > VAULT_ENVELOPE_NAME_MAX_CODE_POINTS
  ) {
    throw envelopeInvalid('vaultName must be a non-empty string within the length limit');
  }
  const saltBytes = decodeEnvelopeField('salt', salt);
  if (saltBytes.length !== VAULT_ENVELOPE_SALT_BYTES) {
    throw envelopeInvalid(`salt must decode to exactly ${VAULT_ENVELOPE_SALT_BYTES} bytes`);
  }
  if (!Array.isArray(accounts)) throw envelopeInvalid('accounts must be an array');
  if (accounts.length > VAULT_ENVELOPE_MAX_ACCOUNTS) {
    throw limitExceeded(`vault carries more than ${VAULT_ENVELOPE_MAX_ACCOUNTS} accounts`);
  }
  const accountNames = new Set<string>();
  const usedIvs = new Set<string>();
  let keyCount = 0;
  const validatedAccounts = accounts.map((account) => {
    const validated = validateAccount(account, usedIvs);
    const normalized = normalizeSteemUsername(validated.accountName);
    if (accountNames.has(normalized)) throw envelopeInvalid('account names must be unique');
    accountNames.add(normalized);
    keyCount += VAULT_KEY_ROLES.reduce((sum, role) => sum + validated.keys[role].length, 0);
    if (keyCount > VAULT_ENVELOPE_MAX_KEYS) {
      throw limitExceeded(`vault carries more than ${VAULT_ENVELOPE_MAX_KEYS} keys`);
    }
    return validated;
  });
  const validated: VaultEnvelopeV1 = {
    version: 1,
    vaultName,
    salt: salt as string,
    accounts: validatedAccounts,
  };
  const serialized = JSON.stringify(validated);
  if (
    serialized.length > VAULT_ENVELOPE_JSON_MAX_BYTES ||
    new TextEncoder().encode(serialized).length > VAULT_ENVELOPE_JSON_MAX_BYTES
  ) {
    throw limitExceeded('vault envelope exceeds the maximum UTF-8 size');
  }
  return validated;
}

export function parseVaultEnvelopeJson(raw: string): VaultEnvelopeV1 {
  if (typeof raw !== 'string') throw envelopeInvalid('envelope JSON input must be a string');
  if (
    raw.length > VAULT_ENVELOPE_JSON_MAX_BYTES ||
    new TextEncoder().encode(raw).length > VAULT_ENVELOPE_JSON_MAX_BYTES
  ) {
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

export function emptyVaultRoleKeys(): VaultRoleKeys {
  return { owner: [], active: [], posting: [], memo: [] };
}
