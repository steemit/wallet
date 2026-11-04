// Vault-mode transaction signer (A4) — signs with WIFs held by an unlocked
// vault service session, behind a mandatory fresh on-chain authority check.
//
// LAYERING: this module is vault-internal feature code on top of the A2/A3
// primitives (registry + unlock-session service). It never talks to IndexedDB
// directly and never re-implements validation — account-name normalization
// comes from the shared `normalizeSteemUsername`, WIF checking/public-key
// derivation from the shared `validateVaultWif` entry point.
//
// STEEM AUTHORITY SEMANTICS (docs/AI-driver/02-auth.md, verified against Steem
// core v0.23.0 `transaction_util.hpp` + live mainnet): consensus
// `verify_authority` falls back DOWNWARD — a posting-class op accepts a key
// from the account's posting, active OR owner authority; an active-class op
// accepts active or owner; owner-class ops are owner-only. A higher key can
// stand in for a lower authority, never the reverse. Key selection here walks
// the authority levels from the least privileged one the request allows
// upward, and `SignResult.role` reports the level actually used.
// `database_api.get_required_signatures` is deliberately NOT consulted — it
// computes a strict per-class minimal set and is not an acceptance oracle
// (the #375/#378 lesson).
//
// PRE-SIGNING AUTHORITY REFRESH — traffic contract (kickoff A4, 2026-11-04
// ruling, aligned with the relay's "protect api.steemit.com" goal):
//   - the final signing path queries `/api/query/accounts` through the single
//     client entry point (`fetchAccounts` in @/lib/steem/accounts-client) with
//     `fresh: true` — ONE sorted, batched, deduplicated call per signing
//     request, never per component, never polling;
//   - `fresh: true` bypasses only the browser L1 cache (the `cachedFetch`
//     noStore branch); the server-side `withCache(cacheKey, 10, 300, …)`
//     governance on the route is untouched;
//   - a response carrying `degraded`, a missing/short `accounts` list,
//     malformed authority data or a failed fetch rejects with
//     `VAULT_AUTHORITY_UNAVAILABLE` BEFORE anything is signed — the vault's
//     local payload is never accepted as a substitute for this query;
//   - the local vault snapshot is consulted only to SELECT which key to use.
//
// SENSITIVE-DATA RULES: the WIF leaves the captured session payload only as
// an argument to `steem.auth.signTransaction` (client-side signing, exactly
// like src/lib/steem/client.ts). It never enters the returned `SignResult`,
// error messages, logs or the network. A successful signing does NOT lock the
// vault — signing is high-frequency; locking stays a user/orchestration act
// (`SignResult.locked` is therefore always `false`).
import { steem } from '@steemit/steem-js';

import { apiClient } from '@/lib/steem/client';
import { fetchAccounts, type AccountsResponse } from '@/lib/steem/accounts-client';
import { isValidSteemUsernameFormat, normalizeSteemUsername } from '@/lib/steem/username';
import type { KeyAuthority, Operation, SteemAccount } from '@/lib/steem/types';
import { VaultError } from './errors';
import type { VaultRegistry } from './registry';
import type { VaultService, VaultServiceStatus } from './service';
import type {
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  SigningRole,
  UnsignedTransaction,
  VaultKeyEntry,
  VaultPayloadV1,
} from './types';
import { validateVaultWif } from './validation';

/** Authority classes as Steem core assigns them to operations. */
export type AuthorityClass = 'posting' | 'active' | 'owner';

/**
 * Fixed authority-class table for every operation type the wallet's broadcast
 * surface can produce today. Source: the 19 relay routes under
 * `src/app/api/broadcast/` plus the client-side signing methods in
 * `src/lib/steem/client.ts` (transfer_to_savings / transfer_from_savings /
 * transfer_to_vesting ride the `transfer` relay route). Two operations are
 * payload-dependent and resolved dynamically in
 * {@link resolveRequiredAuthorityClass}:
 *   - `account_update` — owner when the payload carries an `owner` authority,
 *     active otherwise;
 *   - `custom_json` — active when `required_auths` is non-empty, posting when
 *     only `required_posting_auths` is present.
 * UNKNOWN OPERATION TYPES ARE REJECTED (`VAULT_OPERATION_UNSUPPORTED`,
 * fail closed). This table is the A4 interim classifier: the complete
 * per-operation authority/account-field mapping (incl. mixed-authority and
 * multi-account requirements) is B0's job — extend this table, do not loosen
 * the default.
 */
const OPERATION_AUTHORITY_CLASSES: Readonly<Record<string, AuthorityClass>> = {
  // active-class operations (relayed by their own or the transfer route)
  transfer: 'active',
  transfer_to_savings: 'active',
  transfer_from_savings: 'active',
  cancel_transfer_from_savings: 'active',
  transfer_to_vesting: 'active',
  withdraw_vesting: 'active',
  delegate_vesting_shares: 'active',
  convert: 'active',
  limit_order_create: 'active',
  limit_order_cancel: 'active',
  account_witness_vote: 'active',
  account_witness_proxy: 'active',
  update_proposal_votes: 'active',
  create_proposal: 'active',
  remove_proposal: 'active',
  set_withdraw_vesting_route: 'active',
  account_create: 'active',
  // posting-class operations
  claim_reward_balance: 'posting',
  // owner-class operations
  change_recovery_account: 'owner',
  recover_account: 'owner',
};

/** Authority levels in ascending privilege — the chain's coverage direction. */
const PRIVILEGE_ORDER: readonly SigningRole[] = ['posting', 'active', 'owner'];

/** Everything a key-selection pass needs to know about one vault key entry. */
interface VaultKeyCandidate {
  entry: VaultKeyEntry;
  publicKey: string;
}

/** The selected signing material — SENSITIVE: `wif` must not leave this module. */
interface SelectedKey {
  wif: string;
  publicKey: string;
  role: SigningRole;
}

function operationUnsupported(reason: string): VaultError {
  return new VaultError('VAULT_OPERATION_UNSUPPORTED', `operation rejected: ${reason}`);
}

function authorityUnavailable(reason: string): VaultError {
  return new VaultError(
    'VAULT_AUTHORITY_UNAVAILABLE',
    `chain authority data is unavailable or insufficient: ${reason}`,
  );
}

function sessionStale(): VaultError {
  return new VaultError(
    'VAULT_SESSION_STALE',
    'the unlocked vault changed outside this session; unlock again',
  );
}

/** Privilege rank of a signing role (posting < active < owner). */
function privilegeRank(role: SigningRole): number {
  const rank = PRIVILEGE_ORDER.indexOf(role);
  if (rank < 0) {
    throw new TypeError('privilegeRank: role must be one of owner, active, posting');
  }
  return rank;
}

/**
 * Whether an operation tuple has the minimal shape the classifier needs:
 * `[string, plain-object]`.
 */
function isOperationTuple(op: unknown): op is Operation {
  return (
    Array.isArray(op) &&
    op.length === 2 &&
    typeof op[0] === 'string' &&
    typeof op[1] === 'object' &&
    op[1] !== null &&
    !Array.isArray(op[1])
  );
}

/**
 * Resolve the single authority class a set of operations jointly requires:
 * the MOST privileged class among them (a transaction must satisfy every
 * operation it carries, and a higher key covers lower authorities for the
 * same account, so the maximum is both necessary and sufficient).
 *
 * Fail closed: an empty list, a malformed tuple or an operation type missing
 * from the A4 table rejects with `VAULT_OPERATION_UNSUPPORTED` — never a
 * default guess. `account_update`/`custom_json` resolve per payload (see the
 * table JSDoc).
 */
export function resolveRequiredAuthorityClass(operations: readonly unknown[]): AuthorityClass {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw operationUnsupported('no operations were provided to classify');
  }
  let required: AuthorityClass | null = null;
  for (const op of operations) {
    if (!isOperationTuple(op)) {
      throw operationUnsupported('every operation must be a [type, payload] tuple');
    }
    const [type, payload] = op;
    let cls: AuthorityClass;
    if (type === 'account_update') {
      cls = payload['owner'] !== undefined && payload['owner'] !== null ? 'owner' : 'active';
    } else if (type === 'custom_json') {
      const requiredAuths = payload['required_auths'];
      const requiredPostingAuths = payload['required_posting_auths'];
      if (Array.isArray(requiredAuths) && requiredAuths.length > 0) {
        cls = 'active';
      } else if (Array.isArray(requiredPostingAuths) && requiredPostingAuths.length > 0) {
        cls = 'posting';
      } else {
        throw operationUnsupported('custom_json carries no required auths');
      }
    } else {
      const known = OPERATION_AUTHORITY_CLASSES[type];
      if (known === undefined) {
        throw operationUnsupported('operation type is not in the supported signing table');
      }
      cls = known;
    }
    if (required === null || privilegeRank(cls) > privilegeRank(required)) {
      required = cls;
    }
  }
  if (required === null) {
    throw operationUnsupported('no operations were provided to classify');
  }
  return required;
}

/** Internal marker used by {@link readUnlockedPayload} to abort a no-write read. */
class PayloadCaptureSignal extends Error {
  constructor() {
    super('vault payload capture abort');
    this.name = 'PayloadCaptureSignal';
  }
}

/**
 * Read a deep copy of the currently unlocked session's payload WITHOUT
 * writing anything. VAULT-INTERNAL ONLY (the docs/AI-driver/09-vault.md
 * invariant 14 mutator boundary applies to the mechanism): the service offers
 * no read-only payload export by design, and this helper deliberately reuses
 * `mutatePayload`'s documented rollback contract — "a throwing mutator
 * changes nothing: no write, session untouched" — to capture the draft and
 * abort. Nothing is persisted, no revision is bumped, no IV is rotated.
 *
 * The returned `VaultPayloadV1` contains WIFs: it must never cross into
 * components, Redux, logs or the network. Callers today: this module's key
 * selection and the manager's changePassword composition.
 *
 * Failures: `VAULT_LOCKED` (nothing unlocked), `VAULT_SESSION_STALE` (the
 * vault changed outside this session) — both surface from the service's own
 * session-bound hard line, which runs inside every `mutatePayload` call.
 */
export async function readUnlockedPayload(service: VaultService): Promise<VaultPayloadV1> {
  let captured: VaultPayloadV1 | undefined;
  try {
    await service.mutatePayload((draft) => {
      captured = JSON.parse(JSON.stringify(draft)) as VaultPayloadV1;
      throw new PayloadCaptureSignal();
    });
  } catch (error) {
    if (!(error instanceof PayloadCaptureSignal)) {
      throw error;
    }
  }
  if (captured === undefined) {
    // Unreachable (the mutator always runs or the call rejects) — kept as a
    // fail-closed guard so a future service change cannot silently yield
    // "no payload" as success.
    throw new VaultError('VAULT_LOCKED', 'no vault is unlocked in this session');
  }
  return captured;
}

/**
 * Validate and normalize the request's account name through the shared
 * `normalizeSteemUsername` entry point (format failures → `VAULT_KEY_INVALID`).
 * Shared with the legacy privateKey signer (same interface, same rules).
 */
export function normalizeRequestAccount(request: { accountName: unknown }): string {
  if (typeof request.accountName !== 'string' || request.accountName.length === 0) {
    throw new VaultError('VAULT_KEY_INVALID', 'account name must be a non-empty string');
  }
  const normalized = normalizeSteemUsername(request.accountName);
  if (!isValidSteemUsernameFormat(normalized)) {
    throw new VaultError('VAULT_KEY_INVALID', 'account name is not a valid Steem account name');
  }
  return normalized;
}

/**
 * Validate the requested signing role. `memo` is storable but NEVER signs
 * (`VAULT_KEY_INVALID`); values outside the fixed vocabulary are a programmer
 * error (`TypeError`).
 */
export function requireSigningRole(role: unknown): SigningRole {
  if (role === 'owner' || role === 'active' || role === 'posting') {
    return role;
  }
  if (role === 'memo') {
    throw new VaultError('VAULT_KEY_INVALID', 'the memo key can be stored but never signs');
  }
  throw new TypeError('signing role must be one of owner, active, posting');
}

/**
 * The authority levels the key selection may walk, from least to most
 * privileged: starts at the MORE privileged of the requested role (the
 * caller's explicit floor — callers ask for what they need) and the class the
 * operations require (the chain's hard floor), then climbs per the consensus
 * downward-coverage rule. The selection never goes BELOW either floor.
 */
function authorityWalkLevels(requestedRole: SigningRole, requiredClass: AuthorityClass): SigningRole[] {
  const start = Math.max(privilegeRank(requestedRole), privilegeRank(requiredClass));
  return PRIVILEGE_ORDER.slice(start);
}

/**
 * Select the least-privileged vault key the chain will accept for
 * `accountName` at authority class `requiredClass`.
 *
 * For each authority level in walk order (see {@link authorityWalkLevels}),
 * every `key_auths` entry of the ON-CHAIN authority is checked — never just
 * `key_auths[0]` (the known login-flow limitation; a vault key sitting at
 * index 1+ must be found). A key is USABLE when its weight alone meets the
 * authority's `weight_threshold` (single-key satisfaction) AND its public key
 * is derived from a vault entry of this account with a non-memo role. Memo
 * entries are excluded outright: the chain's `memo_key` satisfies no
 * operation authority.
 *
 * Returns `null` when nothing satisfies — thresholds requiring accumulated
 * weights, `account_auths`-graph authorities or key sets the vault simply
 * does not hold all land here and the caller reports
 * `VAULT_AUTHORITY_UNAVAILABLE` (the JSDoc distinction: "chain says no
 * single key of ours is enough" versus "we could not read the chain").
 */
function selectSigningKey(
  payload: VaultPayloadV1,
  accountName: string,
  requestedRole: SigningRole,
  requiredClass: AuthorityClass,
  account: SteemAccount,
): SelectedKey | null {
  const candidates: VaultKeyCandidate[] = [];
  for (const entry of payload.keys) {
    if (entry.role === 'memo') {
      continue; // memo keys never sign
    }
    if (normalizeSteemUsername(entry.accountName) !== accountName) {
      continue;
    }
    // Shared entry point: real isWif + public-key derivation (mock-driven
    // under vitest; real-crypto evidence lives in tests/node/vault-wif-real-check.mjs).
    const check = validateVaultWif(entry.privateKey, entry.accountName);
    candidates.push({ entry, publicKey: check.publicKey });
  }
  for (const level of authorityWalkLevels(requestedRole, requiredClass)) {
    const authority: KeyAuthority | undefined = account[level];
    if (
      typeof authority !== 'object' ||
      authority === null ||
      !Number.isFinite(authority.weight_threshold) ||
      !Array.isArray(authority.key_auths)
    ) {
      // Authority data missing/malformed for this level — the precheck
      // treats that as unavailable; selection skips the level defensively.
      continue;
    }
    const threshold = authority.weight_threshold;
    for (const pair of authority.key_auths) {
      if (!Array.isArray(pair)) {
        continue;
      }
      const publicKey = pair[0];
      const weight = Number(pair[1]);
      if (typeof publicKey !== 'string' || !Number.isFinite(weight)) {
        continue;
      }
      if (weight < threshold) {
        continue; // below threshold even alone — not usable
      }
      const candidate = candidates.find((c) => c.publicKey === publicKey);
      if (candidate) {
        return { wif: candidate.entry.privateKey, publicKey, role: level };
      }
    }
  }
  return null;
}

/**
 * One sorted, batched, deduplicated `/api/query/accounts` query with
 * `fresh: true` (browser-L1 bypass; server cache governance untouched) for
 * the accounts the signing decision depends on. Any degradation — fetch
 * failure, `success !== true`, a `degraded` flag in the body, a missing
 * account, or authority fields that are not usable — rejects with
 * `VAULT_AUTHORITY_UNAVAILABLE`.
 */
async function fetchAuthorityAccounts(names: readonly string[]): Promise<Map<string, SteemAccount>> {
  const wanted = [...new Set(names.map((n) => normalizeSteemUsername(n)).filter(Boolean))].sort();
  if (wanted.length === 0) {
    throw authorityUnavailable('no account names were provided to verify');
  }
  let response: AccountsResponse;
  try {
    response = await fetchAccounts(wanted, { fresh: true });
  } catch {
    throw authorityUnavailable('the accounts query could not be completed');
  }
  if (response.success !== true || !Array.isArray(response.accounts)) {
    throw authorityUnavailable('the accounts query did not return account data');
  }
  // The route stamps `degraded: true` into the JSON body whenever it serves
  // degraded/stale upstream data (and on its 503 path) — the type omits the
  // optional flag, so read it through a widened view.
  const flagged = response as AccountsResponse & { degraded?: unknown };
  if (flagged.degraded === true) {
    throw authorityUnavailable('the accounts query reported degraded data');
  }
  const byName = new Map<string, SteemAccount>();
  for (const account of response.accounts) {
    if (typeof account !== 'object' || account === null || typeof account.name !== 'string') {
      continue;
    }
    byName.set(normalizeSteemUsername(account.name), account);
  }
  for (const name of wanted) {
    const account = byName.get(name);
    if (account === undefined) {
      throw authorityUnavailable('an involved account is missing from the response');
    }
    for (const level of ['owner', 'active', 'posting'] as const) {
      const authority = account[level];
      if (
        typeof authority !== 'object' ||
        authority === null ||
        !Number.isFinite(authority.weight_threshold) ||
        !Array.isArray(authority.key_auths) ||
        !Array.isArray(authority.account_auths)
      ) {
        throw authorityUnavailable('authority data is missing for an involved account');
      }
    }
  }
  return byName;
}

/**
 * Defense-in-depth mid-flight re-verification: the service's own hard line
 * ran at entry (`getStatus`), but the authority query and the transaction
 * header fetch leave await gaps during which the vault could be locked,
 * mutated, renamed or removed (by this tab or another). Before the WIF is
 * used, re-read the registry and compare the snapshot's counters. `createdAt`
 * is not observable through the service status; the four-field comparison
 * remains the service's job on its next session-bound operation — this check
 * closes the signer-specific gap between "verified" and "signed".
 */
async function assertSessionStillCurrent(
  registry: VaultRegistry,
  snapshot: VaultServiceStatus,
): Promise<void> {
  if (snapshot.vaultName === null) {
    throw sessionStale();
  }
  const record = await registry.getRecord(snapshot.vaultName);
  if (
    record === null ||
    record.revision !== snapshot.revision ||
    record.lockEpoch !== snapshot.lockEpoch
  ) {
    throw sessionStale();
  }
}

/** Hex-encode the first `bytes` of a SHA-256 digest — Steem's transaction id. */
async function computeTransactionId(unsigned: UnsignedTransaction): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new VaultError(
      'VAULT_CRYPTO_UNAVAILABLE',
      'Web Crypto subtle API is unavailable in this environment',
    );
  }
  // Serialize the NORMALIZED unsigned form — the same bytes a node hashes for
  // the transaction id (missing vs empty `signatures` serialize differently;
  // the unsigned object carries no signatures field at all).
  const normalized = steem.auth.normalizeTransactionForBroadcast(
    unsigned as unknown as Record<string, unknown>,
  );
  const serialized = steem.auth.serializeTransaction(normalized);
  const bytes = new Uint8Array(serialized);
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < 20; i += 1) {
    hex += (digest[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/** Sign a built transaction with the selected key (client-side only). */
async function signWithKey(
  unsigned: UnsignedTransaction,
  key: SelectedKey,
  accountName: string,
): Promise<SignResult> {
  // steem.auth.signTransaction internally normalizes and signs the digest;
  // the follow-up normalize mirrors src/lib/steem/client.ts and is idempotent.
  const signed = steem.auth.signTransaction(unsigned, [key.wif]);
  const signedTx = steem.auth.normalizeTransactionForBroadcast(
    signed as unknown as Record<string, unknown>,
  ) as unknown as SignResult['signedTx'];
  return {
    signedTx,
    transactionId: await computeTransactionId(unsigned),
    accountName,
    role: key.role,
    publicKey: key.publicKey,
    locked: false, // signing never auto-locks; see the module header
  };
}

/**
 * Build the vault-mode signer over a registry and an unlock-session service.
 * The service instance MUST be the one whose session the surrounding UI
 * unlocks (one tab = one manager = one service; see
 * `VaultManager.createSigner` for the sanctioned composition).
 */
export function createVaultSigner(registry: VaultRegistry, service: VaultService) {
  return {
    /**
     * Sign freshly built operations with a key from the unlocked vault.
     *
     * Flow: classify + shape-check the operations (fail closed) → session
     * entry check (`VAULT_LOCKED` when nothing is unlocked; the service's
     * registry hard line runs inside) → ONE fresh batched authority query →
     * key selection over the captured payload (`VAULT_AUTHORITY_UNAVAILABLE`
     * when no single held key satisfies the on-chain authority — never sign,
     * never touch the network for a header) → transaction header fetch →
     * mid-flight session re-verification → client-side signing.
     *
     * `SignResult.role` reports the authority level actually used (downward
     * coverage: a posting-class op may legitimately be signed with an active
     * or owner key when that is what the vault holds).
     */
    async signOperations(request: SignOperationsRequest): Promise<SignResult> {
      const requiredClass = resolveRequiredAuthorityClass(request?.operations);
      const role = requireSigningRole(request?.role);
      const accountName = normalizeRequestAccount(request);
      const status = await service.getStatus();
      if (status.locked) {
        throw new VaultError('VAULT_LOCKED', 'no vault is unlocked in this session');
      }
      const accounts = await fetchAuthorityAccounts([accountName]);
      const account = accounts.get(accountName);
      if (account === undefined) {
        throw authorityUnavailable('an involved account is missing from the response');
      }
      const payload = await readUnlockedPayload(service);
      const selected = selectSigningKey(payload, accountName, role, requiredClass, account);
      if (selected === null) {
        throw authorityUnavailable(
          'no vault-held key satisfies the account authority for the requested operations',
        );
      }
      const header = await apiClient.getTransactionHeader();
      await assertSessionStillCurrent(registry, status);
      const unsigned: UnsignedTransaction = {
        ref_block_num: header.ref_block_num,
        ref_block_prefix: header.ref_block_prefix,
        expiration: header.expiration,
        operations: request.operations,
        extensions: [],
      };
      return signWithKey(unsigned, selected, accountName);
    },

    /**
     * Sign an already-frozen transaction EXACTLY as received: no header
     * refresh, no re-construction, no re-normalization of any non-signature
     * field (`ref_block_num`/`ref_block_prefix`/`expiration`/operations pass
     * verbatim into the signing call). The same session hard line and the
     * same fresh authority precheck apply — only the transaction source
     * differs.
     */
    async signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult> {
      const transaction = request?.transaction;
      if (
        typeof transaction !== 'object' ||
        transaction === null ||
        !Number.isFinite(transaction.ref_block_num) ||
        !Number.isFinite(transaction.ref_block_prefix) ||
        typeof transaction.expiration !== 'string' ||
        transaction.expiration.length === 0 ||
        !Array.isArray(transaction.operations)
      ) {
        throw operationUnsupported('transaction is not a frozen unsigned transaction');
      }
      const requiredClass = resolveRequiredAuthorityClass(transaction.operations);
      const role = requireSigningRole(request?.role);
      const accountName = normalizeRequestAccount(request);
      const status = await service.getStatus();
      if (status.locked) {
        throw new VaultError('VAULT_LOCKED', 'no vault is unlocked in this session');
      }
      const accounts = await fetchAuthorityAccounts([accountName]);
      const account = accounts.get(accountName);
      if (account === undefined) {
        throw authorityUnavailable('an involved account is missing from the response');
      }
      const payload = await readUnlockedPayload(service);
      const selected = selectSigningKey(payload, accountName, role, requiredClass, account);
      if (selected === null) {
        throw authorityUnavailable(
          'no vault-held key satisfies the account authority for the requested operations',
        );
      }
      await assertSessionStillCurrent(registry, status);
      // Frozen semantics: the object is handed to the signer as-is. The txid
      // is computed over a shallow copy's normalized serialization so the
      // caller's frozen object is never mutated.
      const signed = steem.auth.signTransaction(transaction, [selected.wif]);
      const signedTx = signed as SignResult['signedTx'];
      const transactionId = await computeTransactionId({ ...transaction });
      return {
        signedTx,
        transactionId,
        accountName,
        role: selected.role,
        publicKey: selected.publicKey,
        locked: false,
      };
    },
  };
}
