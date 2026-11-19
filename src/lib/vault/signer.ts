import { steem } from '@steemit/steem-js';

import { apiClient } from '@/lib/steem/client';
import { fetchAccounts, type AccountsResponse } from '@/lib/steem/accounts-client';
import { isValidSteemUsernameFormat, normalizeSteemUsername } from '@/lib/steem/username';
import type { KeyAuthority, Operation, SteemAccount } from '@/lib/steem/types';
import { decodeBase64Url } from './envelope';
import { decryptVaultKey, deriveVaultKek } from './crypto';
import { VaultError } from './errors';
import type { VaultService } from './service';
import type { VaultRevisionPointer } from './registry';
import type {
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  SigningRole,
  UnsignedTransaction,
  VaultKeyCiphertext,
  VaultRecordV1,
  VaultSigningSession,
} from './types';
import { validateVaultWif } from './validation';

export type AuthorityClass = 'posting' | 'active' | 'owner';

const OPERATION_AUTHORITY_CLASSES: Readonly<Record<string, AuthorityClass>> = {
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
  claim_reward_balance: 'posting',
  change_recovery_account: 'owner',
};

const PRIVILEGE_ORDER: readonly SigningRole[] = ['posting', 'active', 'owner'];

function operationUnsupported(reason: string): VaultError {
  return new VaultError('VAULT_OPERATION_UNSUPPORTED', `operation rejected: ${reason}`);
}

function authorityUnavailable(reason: string): VaultError {
  return new VaultError(
    'VAULT_AUTHORITY_UNAVAILABLE',
    `chain authority data is unavailable or insufficient: ${reason}`,
  );
}

function privilegeRank(role: SigningRole): number {
  const rank = PRIVILEGE_ORDER.indexOf(role);
  if (rank < 0) throw new TypeError('role must be one of owner, active, posting');
  return rank;
}

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

/** recover_account is excluded: recovery keeps client.ts's dedicated dual-signature path. */
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
      const active = payload['required_auths'];
      const posting = payload['required_posting_auths'];
      if (Array.isArray(active) && active.length > 0) cls = 'active';
      else if (Array.isArray(posting) && posting.length > 0) cls = 'posting';
      else throw operationUnsupported('custom_json carries no required auths');
    } else {
      const known = OPERATION_AUTHORITY_CLASSES[type];
      if (known === undefined) {
        throw operationUnsupported('operation type is not in the supported signing table');
      }
      cls = known;
    }
    if (required === null || privilegeRank(cls) > privilegeRank(required)) required = cls;
  }
  if (required === null) throw operationUnsupported('no operations were provided to classify');
  return required;
}

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

export function requireSigningRole(role: unknown): SigningRole {
  if (role === 'owner' || role === 'active' || role === 'posting') return role;
  if (role === 'memo') {
    throw new VaultError('VAULT_KEY_INVALID', 'the memo key can be stored but never signs');
  }
  throw new TypeError('signing role must be one of owner, active, posting');
}

async function fetchAuthorityAccounts(names: readonly string[]): Promise<Map<string, SteemAccount>> {
  const wanted = [...new Set(names.map((name) => normalizeSteemUsername(name)).filter(Boolean))].sort();
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
      byName.set(normalizeSteemUsername(account.name), account);
    }
  }
  for (const name of wanted) {
    const account = byName.get(name);
    if (account === undefined) throw authorityUnavailable('an involved account is missing');
    for (const level of PRIVILEGE_ORDER) {
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

function pointerOf(record: VaultRecordV1): VaultRevisionPointer {
  return {
    vaultName: record.vaultName,
    createdAt: record.createdAt,
    revision: record.revision,
    lockEpoch: record.lockEpoch,
  };
}

function selectEncryptedKey(
  record: VaultRecordV1,
  accountName: string,
  role: SigningRole,
  keyIv: string,
): VaultKeyCiphertext {
  if (typeof keyIv !== 'string' || keyIv.length === 0) {
    throw new VaultError('VAULT_KEY_INVALID', 'a specific key IV must be selected');
  }
  const account = record.accounts.find(
    (candidate) => normalizeSteemUsername(candidate.accountName) === accountName,
  );
  const selected = account?.keys[role].find((key) => key.iv === keyIv);
  if (!selected) {
    throw new VaultError('VAULT_KEY_INVALID', 'the selected encrypted key does not exist');
  }
  return selected;
}

function verifySelectedAuthority(
  account: SteemAccount,
  publicKey: string,
  requestedRole: SigningRole,
  requiredClass: AuthorityClass,
): SigningRole {
  const start = Math.max(privilegeRank(requestedRole), privilegeRank(requiredClass));
  for (const level of PRIVILEGE_ORDER.slice(start)) {
    const authority: KeyAuthority | undefined = account[level];
    if (!authority) continue;
    for (const pair of authority.key_auths) {
      if (!Array.isArray(pair)) continue;
      const candidate = pair[0];
      const weight = Number(pair[1]);
      if (
        candidate === publicKey &&
        Number.isFinite(weight) &&
        weight >= authority.weight_threshold
      ) {
        return level;
      }
    }
  }
  throw authorityUnavailable('the selected key does not satisfy the on-chain authority');
}

async function computeTransactionId(unsigned: UnsignedTransaction): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new VaultError(
      'VAULT_CRYPTO_UNAVAILABLE',
      'Web Crypto subtle API is unavailable in this environment',
    );
  }
  const normalized = steem.auth.normalizeTransactionForBroadcast(
    unsigned as unknown as Record<string, unknown>,
  );
  const bytes = new Uint8Array(steem.auth.serializeTransaction(normalized));
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < 20; i += 1) hex += (digest[i] ?? 0).toString(16).padStart(2, '0');
  return hex;
}

interface SigningRequestBase {
  accountName: string;
  role: SigningRole;
  keyIv: string;
  vaultPassword: string;
}

async function signVaultTransaction(
  service: VaultService,
  request: SigningRequestBase,
  requiredClass: AuthorityClass,
  buildTransaction: () => Promise<UnsignedTransaction>,
  normalizeSigned: boolean,
): Promise<SignResult> {
  const password = request.vaultPassword;
  try {
    const role = requireSigningRole(request.role);
    const accountName = normalizeRequestAccount(request);
    const record = await service.getRecordSnapshot();
    const encrypted = selectEncryptedKey(record, accountName, role, request.keyIv);
    const accounts = await fetchAuthorityAccounts([accountName]);
    const account = accounts.get(accountName);
    if (!account) throw authorityUnavailable('an involved account is missing');
    const unsigned = await buildTransaction();
    await service.assertRecordCurrent(pointerOf(record));
    const kek = await deriveVaultKek(password, decodeBase64Url(record.salt));
    let session: VaultSigningSession | null = null;
    try {
      const privateKey = await decryptVaultKey(
        kek,
        decodeBase64Url(encrypted.iv),
        decodeBase64Url(encrypted.ciphertext),
      );
      const check = validateVaultWif(privateKey, accountName);
      const actualRole = verifySelectedAuthority(account, check.publicKey, role, requiredClass);
      session = {
        vaultName: record.vaultName,
        revision: record.revision,
        lockEpoch: record.lockEpoch,
        kek,
        accountName,
        role: actualRole,
        privateKey,
      };
      await service.assertRecordCurrent(pointerOf(record));
      const signed = steem.auth.signTransaction(unsigned, [session.privateKey]);
      const signedTx = (
        normalizeSigned
          ? steem.auth.normalizeTransactionForBroadcast(
              signed as unknown as Record<string, unknown>,
            )
          : signed
      ) as SignResult['signedTx'];
      return {
        signedTx,
        transactionId: await computeTransactionId(unsigned),
        accountName,
        role: actualRole,
        publicKey: check.publicKey,
        locked: true,
      };
    } finally {
      kek.fill(0);
      if (session !== null) session.privateKey = '';
    }
  } finally {
    request.vaultPassword = '';
  }
}

export function createVaultSigner(service: VaultService) {
  return {
    async signOperations(request: SignOperationsRequest): Promise<SignResult> {
      const requiredClass = resolveRequiredAuthorityClass(request?.operations);
      return signVaultTransaction(
        service,
        request,
        requiredClass,
        async () => {
          const header = await apiClient.getTransactionHeader();
          return {
            ref_block_num: header.ref_block_num,
            ref_block_prefix: header.ref_block_prefix,
            expiration: header.expiration,
            operations: request.operations,
            extensions: [],
          };
        },
        true,
      );
    },

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
      return signVaultTransaction(
        service,
        request,
        requiredClass,
        async () => transaction,
        false,
      );
    },
  };
}
