// On-chain key association checks for the R2 key-management UI.
//
// This module NEVER touches private keys: callers derive the public key
// locally (validateVaultWif — the WIF stays in the import dialog's transient
// form state and the vault's internal primitives) and hand over
// (accountName, role, publicKey) candidates only. Nothing here can decrypt,
// sign, write the vault record or otherwise produce side effects — it answers
// one question per candidate: where (if anywhere) does this public key appear
// in the account's on-chain authorities?
//
// Traffic discipline mirrors the signer's authority pre-check (invariant 19):
// ONE sorted, deduplicated, batched `fetchAccounts(..., { fresh: true })`
// query per call (bypasses the browser L1 only — server-side cache
// governance stays intact); degraded / missing / malformed / failed responses
// fail closed with `VAULT_AUTHORITY_UNAVAILABLE` and zero side effects.
//
// Scan semantics: the FULL `key_auths` of all three authority levels
// (owner / active / posting — never just `key_auths[0][0]`, the known
// login-chain limitation does not apply here) plus the account's `memo_key`
// for every candidate regardless of its requested role. A memo-role
// candidate that actually matches a posting key_auths entry is reported as
// such (and vice versa) — the requested role is storage classification, not
// an assumption about the chain. When a key appears in several levels the
// most privileged match wins (owner > active > posting > memo).
//
// STORAGE SEMANTICS (2026-11-05 R2 ruling — results are ADVICE, not gates):
//   - A matched key whose weight ALONE is below `weight_threshold`
//     (`suffices: false`) may still be stored with an explicit warning —
//     the single-key signer keeps failing closed on it (invariant 19) until
//     multi-key signing exists.
//   - A public key that is NOT on-chain at all (`matched: false`) may also
//     be stored with an explicit warning. The vault is STORAGE, not proof of
//     authority: a user may legitimately add a key before updating the
//     account's on-chain authorities, and fail-open storage plus a clear
//     warning beats rejection (a rejected key could not sign anyway).
import { fetchAccounts, type AccountsResponse } from '@/lib/steem/accounts-client';
import type { KeyAuthority, SteemAccount } from '@/lib/steem/types';
import { VaultError } from './errors';
import type { VaultKeyRole } from './types';
import { validateVaultAccountName } from './validation';

/** A key the caller wants checked against the chain. WIF-free by design. */
export interface VaultKeyCandidate {
  accountName: string;
  role: VaultKeyRole;
  publicKey: string;
}

/**
 * On-chain association result for one candidate.
 *
 * - `matched`: the public key was found on-chain (any authority level or the
 *   memo key).
 * - `authority`: the level where the key was found — which may differ from
 *   the requested role. When `matched` is false this echoes the REQUESTED
 *   role (where the user intends to store the key), not a chain fact.
 * - `weight` / `threshold`: the matched key's weight and its authority's
 *   `weight_threshold`. Memo matches carry 1/1 — `memo_key` is a bare key
 *   with no authority weights, and a match means "usable for memos". Both
 *   are 0 placeholders when unmatched.
 * - `suffices`: the key's weight alone meets the threshold (always true for
 *   a memo match). `false` means the single-key signer WILL reject it.
 */
export interface VaultKeyChainMatch {
  matched: boolean;
  authority: VaultKeyRole;
  weight: number;
  threshold: number;
  suffices: boolean;
}

const AUTHORITY_LEVELS = ['owner', 'active', 'posting'] as const;
const VAULT_KEY_ROLES: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

function authorityUnavailable(reason: string): VaultError {
  return new VaultError(
    'VAULT_AUTHORITY_UNAVAILABLE',
    `chain authority data is unavailable or insufficient: ${reason}`,
  );
}

function keyInvalid(reason: string): VaultError {
  return new VaultError('VAULT_KEY_INVALID', `key candidate rejected: ${reason}`);
}

/**
 * Fetch and shape-check the involved accounts. Same contract as the signer's
 * pre-check: normalized + deduplicated + sorted names, one `fresh` query,
 * every involved account present with all three well-formed authorities —
 * plus `memo_key` being a non-empty string (a required condenser_api field;
 * its absence means the whole row is unreliable, so we fail closed even when
 * no memo candidate is involved).
 */
async function fetchChainAccounts(names: readonly string[]): Promise<Map<string, SteemAccount>> {
  const wanted = [...new Set(names.map((name) => normalizeOf(name)))].sort();
  if (wanted.length === 0) throw authorityUnavailable('no account names were provided');
  let response: AccountsResponse;
  try {
    response = await fetchAccounts(wanted, { fresh: true });
  } catch {
    throw authorityUnavailable('the accounts query could not be completed');
  }
  if (response.success !== true || !Array.isArray(response.accounts)) {
    throw authorityUnavailable('the accounts query did not return account data');
  }
  const flagged = response as AccountsResponse & { degraded?: unknown; stale?: unknown };
  if (flagged.degraded === true || flagged.stale === true) {
    throw authorityUnavailable('the accounts query reported degraded data');
  }
  const byName = new Map<string, SteemAccount>();
  for (const account of response.accounts) {
    if (typeof account === 'object' && account !== null && typeof account.name === 'string') {
      byName.set(normalizeOf(account.name), account);
    }
  }
  for (const name of wanted) {
    const account = byName.get(name);
    if (account === undefined) throw authorityUnavailable('an involved account is missing');
    for (const level of AUTHORITY_LEVELS) {
      if (!isWellFormedAuthority(account[level])) {
        throw authorityUnavailable('authority data is missing for an involved account');
      }
    }
    if (typeof account.memo_key !== 'string' || account.memo_key.length === 0) {
      throw authorityUnavailable('memo key data is missing for an involved account');
    }
  }
  return byName;
}

function normalizeOf(name: string): string {
  return validateVaultAccountName(name);
}

function isWellFormedAuthority(authority: unknown): authority is KeyAuthority {
  return (
    typeof authority === 'object' &&
    authority !== null &&
    Number.isFinite((authority as KeyAuthority).weight_threshold) &&
    Array.isArray((authority as KeyAuthority).key_auths) &&
    Array.isArray((authority as KeyAuthority).account_auths)
  );
}

/**
 * Scan one account's authorities for a public key. Malformed key_auths
 * entries (non-array pairs, non-finite weights) are skipped rather than
 * trusted — the same tolerance the signer's selection applies.
 */
function scanAccountForKey(account: SteemAccount, publicKey: string): VaultKeyChainMatch | null {
  for (const level of AUTHORITY_LEVELS) {
    const authority: KeyAuthority | undefined = account[level];
    if (!authority) continue;
    for (const pair of authority.key_auths) {
      if (!Array.isArray(pair)) continue;
      if (pair[0] !== publicKey) continue;
      const weight = Number(pair[1]);
      if (!Number.isFinite(weight)) continue;
      return {
        matched: true,
        authority: level,
        weight,
        threshold: authority.weight_threshold,
        suffices: weight >= authority.weight_threshold,
      };
    }
  }
  if (account.memo_key === publicKey) {
    // memo_key is a bare key with no weights: a match is usable for memos.
    return { matched: true, authority: 'memo', weight: 1, threshold: 1, suffices: true };
  }
  return null;
}

/**
 * Verify candidate keys against the accounts' CURRENT on-chain authorities
 * (one batched `fresh` query for all involved accounts). Returns one result
 * per candidate, in input order. Throws `VAULT_AUTHORITY_UNAVAILABLE`
 * (fail-closed, zero side effects) when the chain data cannot be trusted;
 * throws `VAULT_KEY_INVALID` for malformed candidates. An empty candidate
 * list returns `[]` without touching the network.
 */
export async function verifyKeysOnChain(
  candidates: readonly VaultKeyCandidate[],
): Promise<VaultKeyChainMatch[]> {
  const checked: Array<{ accountName: string; role: VaultKeyRole; publicKey: string }> = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw keyInvalid('candidate must be an object');
    }
    if (!VAULT_KEY_ROLES.includes(candidate.role)) {
      throw keyInvalid('key role is not supported');
    }
    if (
      typeof candidate.publicKey !== 'string' ||
      candidate.publicKey.length <= 3 ||
      !candidate.publicKey.startsWith('STM')
    ) {
      throw keyInvalid('public key must be an STM-prefixed string');
    }
    checked.push({
      accountName: validateVaultAccountName(candidate.accountName),
      role: candidate.role,
      publicKey: candidate.publicKey,
    });
  }
  if (checked.length === 0) return [];
  const byName = await fetchChainAccounts(checked.map((candidate) => candidate.accountName));
  return checked.map((candidate) => {
    const account = byName.get(candidate.accountName);
    if (account === undefined) throw authorityUnavailable('an involved account is missing');
    const match = scanAccountForKey(account, candidate.publicKey);
    if (match !== null) return match;
    return {
      matched: false,
      authority: candidate.role,
      weight: 0,
      threshold: 0,
      suffices: false,
    };
  });
}
