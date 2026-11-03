// Shared vault input validation (A1.1): vault alias names, vault passwords,
// Steem account names and WIF key entries.
//
// These are THE shared entry points for create / independent-import /
// rename / change-password flows (A2 registry and A3 backup reuse them —
// never re-implement the rules at a call site or only in the UI). Two scopes
// are deliberately NOT here: alias uniqueness (A2 registry concern, solved by
// comparing `vaultNameComparisonKey` values inside one IndexedDB readwrite
// transaction) and unlock-path password checks (unlocking must keep accepting
// the vault's existing password — the strength policy never runs there).
//
// SENSITIVE-DATA RULES: this module stores nothing. Passwords and master
// passwords exist only as in-scope arguments and are dropped on return; no
// value is ever logged or embedded in an error message.
//
// WIF checking delegates to the REAL `@steemit/steem-js` auth API
// (`isWif` + `getPublicKey`); in vitest that import is aliased to a mock
// whose `isWif` always returns true — see tests/unit/vault-validation.test.ts
// (mock-driven, branch coverage only) and tests/node/vault-wif-real-check.mjs
// (real crypto verification, run with plain `node`).
import { steem } from '@steemit/steem-js';
import { isValidSteemUsernameFormat, normalizeSteemUsername } from '@/lib/steem/username';
import { VaultError } from './errors';

/**
 * Minimum vault password length in Unicode code points. Code-point counting
 * (not UTF-16 code units) so astral characters each count once.
 */
export const VAULT_PASSWORD_MIN_CODE_POINTS = 14;

/** Maximum vault alias length in Unicode code points. */
export const VAULT_NAME_MAX_CODE_POINTS = 64;

/**
 * Version identifier of the common-password blocklist below. Bump whenever
 * the list changes so callers/tests can pin which version they validated
 * against.
 */
export const VAULT_COMMON_PASSWORDS_VERSION = 1;

/**
 * Common-password blocklist (defense in depth). Most entries are shorter
 * than the 14-code-point minimum and are already rejected by the length
 * rule; the list exists to also block the long classics. Compared with the
 * default lowercase conversion of the candidate password.
 */
export const VAULT_COMMON_PASSWORDS_V1: readonly string[] = [
  'password',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'letmein',
  'iloveyou',
  'admin',
  'steem',
  'steemit',
  'correct horse battery staple',
];

/**
 * Forbidden code-point categories for vault aliases: control (Cc), format
 * (Cf — BOM, ZWSP, soft hyphen, bidi overrides…), surrogate (Cs — unpaired
 * surrogates; a lone \uD800 can arrive via JSON.parse of a crafted backup and
 * is invisible, untrimmable and NFC-invariant, so it must fail closed),
 * line separator (Zl) and paragraph separator (Zp). Properly paired
 * surrogates (astral characters such as U+1F600) are single non-Cs code
 * points and are NOT matched. Unicode property escapes require an ES2018+
 * runtime — same baseline as the Web Crypto API this vault depends on.
 */
const FORBIDDEN_NAME_CODE_POINT_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function nameInvalid(reason: string): VaultError {
  return new VaultError('VAULT_NAME_INVALID', `vault name rejected: ${reason}`);
}

function passwordWeak(reason: string): VaultError {
  return new VaultError('VAULT_PASSWORD_WEAK', `vault password rejected: ${reason}`);
}

function keyInvalid(reason: string): VaultError {
  return new VaultError('VAULT_KEY_INVALID', `vault key entry rejected: ${reason}`);
}

/** Count Unicode code points (surrogate pairs count as one). */
function countCodePoints(value: string): number {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.codePointAt(i);
    if (codePoint !== undefined && codePoint > 0xffff) {
      i += 1; // skip the low surrogate of the pair
    }
    count += 1;
  }
  return count;
}

/**
 * Validate a user-chosen vault alias and return its NFC display value — that
 * normalized value is what callers must store and show.
 *
 * Rules: a non-empty string of 1–64 Unicode code points (code-point count,
 * so 64 astral characters pass and 65 reject), measured BOTH on the raw
 * input and on the NFC display value — normalization expands the few
 * non-starter composition sequences (e.g. U+0344 becomes two combining
 * marks), so a 64-code-point raw input could otherwise grow past the limit
 * the envelope layer enforces on the stored value; no automatic trimming and
 * no leading/trailing whitespace (the raw input is compared against its own
 * `trim()`); no control (Cc), format (Cf), surrogate (Cs — unpaired
 * surrogates), line-separator (Zl) or paragraph-separator (Zp) code points
 * anywhere. Throws `VaultError('VAULT_NAME_INVALID')` — messages never
 * contain the name.
 *
 * Uniqueness is NOT checked here: compare {@link vaultNameComparisonKey}
 * values in the A2 registry's create/rename transaction.
 */
export function validateVaultName(name: unknown): string {
  if (typeof name !== 'string') {
    throw nameInvalid('name must be a string');
  }
  if (name.length === 0) {
    throw nameInvalid('name must not be empty');
  }
  if (name !== name.trim()) {
    throw nameInvalid('name must not start or end with whitespace');
  }
  const codePoints = countCodePoints(name);
  if (codePoints > VAULT_NAME_MAX_CODE_POINTS) {
    throw nameInvalid(
      `name must be at most ${VAULT_NAME_MAX_CODE_POINTS} Unicode code points`,
    );
  }
  const forbidden = FORBIDDEN_NAME_CODE_POINT_RE.exec(name);
  if (forbidden !== null) {
    throw nameInvalid(
      'name must not contain control, format, unpaired-surrogate, line-separator or paragraph-separator characters',
    );
  }
  // Re-measure AFTER NFC: U+0344-style inputs double their code-point count
  // under normalization, and the returned display value is what later layers
  // (envelope) validate at 64 — reject here so both layers stay consistent.
  const display = name.normalize('NFC');
  if (countCodePoints(display) > VAULT_NAME_MAX_CODE_POINTS) {
    throw nameInvalid(
      `name must be at most ${VAULT_NAME_MAX_CODE_POINTS} Unicode code points after normalization`,
    );
  }
  return display;
}

/**
 * Uniqueness comparison key for vault aliases: `NFC(name).toLowerCase()`.
 * Two names conflict when their keys are equal (so `Work`/`work` collide and
 * NFC/NFD `Café` collide) while their NFC display values may differ. The key
 * is a comparison artifact only — it is not the vault identity and never
 * enters the envelope AAD.
 */
export function vaultNameComparisonKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Context for {@link validateVaultPassword}. Both fields are OPTIONAL and
 * flow-scoped:
 *
 * - `accountName`: the Steem account name, compared only in flows where the
 *   account is already known (create-from-account, import).
 * - `masterPassword`: the Steem master password THE SAME flow actually
 *   received from the user. "Same flow, same input" semantics (2026-11-04
 *   ruling): never ask for it just to compare, never persist it, never read
 *   it across flows. It is compared in memory and discarded with the call.
 */
export interface VaultPasswordContext {
  accountName?: string;
  masterPassword?: string;
}

/**
 * Validate a candidate vault password against the strength policy (fail
 * closed with `VAULT_PASSWORD_WEAK`). Policy applies ONLY to create,
 * independent import and change-password flows — unlocking, exporting and
 * deleting must keep accepting the vault's existing password.
 *
 * Rules, in order:
 * 1. at least {@link VAULT_PASSWORD_MIN_CODE_POINTS} Unicode code points;
 * 2. not equal (after the default lowercase conversion) to a versioned
 *    common-password blocklist entry;
 * 3. when `context.accountName` is provided by the flow: not equal to the
 *    `normalizeSteemUsername` form of that account name;
 * 4. when `context.masterPassword` is provided by the same flow: not equal
 *    to it (exact comparison; the value is dropped on return).
 *
 * Error messages never contain the password, account name or master password.
 */
export function validateVaultPassword(
  password: unknown,
  context?: VaultPasswordContext,
): void {
  if (typeof password !== 'string') {
    throw passwordWeak('password must be a string');
  }
  if (countCodePoints(password) < VAULT_PASSWORD_MIN_CODE_POINTS) {
    throw passwordWeak(
      `password must be at least ${VAULT_PASSWORD_MIN_CODE_POINTS} Unicode code points long`,
    );
  }
  const lowercased = password.toLowerCase();
  if (VAULT_COMMON_PASSWORDS_V1.includes(lowercased)) {
    throw passwordWeak(
      `password is on the common-password blocklist (v${VAULT_COMMON_PASSWORDS_VERSION})`,
    );
  }
  if (
    typeof context?.accountName === 'string' &&
    context.accountName.length > 0 &&
    lowercased === normalizeSteemUsername(context.accountName)
  ) {
    throw passwordWeak('password must not equal the account name');
  }
  if (
    typeof context?.masterPassword === 'string' &&
    context.masterPassword.length > 0 &&
    password === context.masterPassword
  ) {
    // In-memory comparison only; the argument goes out of scope on return —
    // this module never stores, logs or re-reads it.
    throw passwordWeak('password must not equal the master password used in this flow');
  }
}

/**
 * Normalize and validate a Steem account name destined for a vault key
 * entry, using the SHARED `normalizeSteemUsername` entry point (never a bare
 * `toLowerCase`). Throws `VaultError('VAULT_KEY_INVALID')` when the
 * normalized name fails the account-name format contract; returns the
 * normalized name for storage. Messages never contain the input name.
 */
export function validateVaultAccountName(accountName: unknown): string {
  if (typeof accountName !== 'string' || accountName.length === 0) {
    throw keyInvalid('account name must be a non-empty string');
  }
  const normalized = normalizeSteemUsername(accountName);
  if (!isValidSteemUsernameFormat(normalized)) {
    throw keyInvalid(
      'account name is not a valid Steem account name (3-16 chars of a-z, 0-9, . or -)',
    );
  }
  return normalized;
}

/** Result of a successful WIF entry validation. */
export interface VaultWifCheck {
  /** The `normalizeSteemUsername` form of the account name. */
  accountName: string;
  /** The STM-prefixed public key derived from the WIF. */
  publicKey: string;
}

/**
 * Validate one stored key entry's WIF and account association (offline; this
 * is NOT the pre-signing on-chain authority check — that is A4).
 *
 * Steps: normalize/validate the account name, then run the WIF through the
 * real `steem.auth.isWif` checksum validation, then derive the public key
 * with `steem.auth.getPublicKey`. Any failure — non-string/empty WIF, failed
 * WIF checksum, derivation error or a non-STM result — throws
 * `VaultError('VAULT_KEY_INVALID')`. Messages never echo the WIF or account
 * name.
 */
export function validateVaultWif(wif: unknown, accountName: unknown): VaultWifCheck {
  const normalizedAccount = validateVaultAccountName(accountName);
  if (typeof wif !== 'string' || wif.length === 0) {
    throw keyInvalid('private key must be a non-empty string');
  }
  if (!steem.auth.isWif(wif)) {
    throw keyInvalid('private key is not a valid Steem WIF (checksum failed)');
  }
  let publicKey: unknown;
  try {
    publicKey = steem.auth.getPublicKey(wif);
  } catch {
    throw keyInvalid('public key derivation failed for the private key');
  }
  if (typeof publicKey !== 'string' || !publicKey.startsWith('STM') || publicKey.length <= 3) {
    throw keyInvalid('derived public key is not a valid STM public key');
  }
  return { accountName: normalizedAccount, publicKey };
}
