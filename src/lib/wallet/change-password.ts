import { steem } from '@steemit/steem-js';
import { SteemSigner } from '@/lib/steem/client';
import type { Operation, SteemAccount } from '@/lib/steem/types';

export type PasswordAuthRole = 'owner' | 'active' | 'posting' | 'memo';

const AUTHORITY_ROLES: Exclude<PasswordAuthRole, 'memo'>[] = ['owner', 'active', 'posting'];

/** Generate a random master password prefixed with P (legacy wallet-legacy parity). */
export function generateNewMasterPassword(): string {
  // Use cryptographically strong entropy only — fail-closed if crypto is
  // unavailable (do NOT fall back to Math.random, which is predictable).
  const c = typeof globalThis !== 'undefined' && (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.randomUUID !== 'function') {
    throw new Error('secure entropy source unavailable');
  }
  const entropy = `${Date.now()}-${c.randomUUID()}`;
  return `P${steem.auth.getPrivateKey(entropy)}`;
}

/** Reject Steem public keys in the current-password field (legacy ChangePassword validation). */
export function looksLikePublicKey(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || SteemSigner.isValidPrivateKey(trimmed)) return false;
  return /^STM[A-Za-z0-9]+$/.test(trimmed);
}

function derivePrivateKeyFromAuth(
  accountName: string,
  authType: PasswordAuthRole,
  authValue: string
): { privateKey: string; publicKey: string } {
  if (SteemSigner.isValidPrivateKey(authValue)) {
    const privateKey = authValue;
    return { privateKey, publicKey: steem.auth.wifToPublic(privateKey) };
  }
  const privateKey = steem.auth.toWif(accountName, authValue, authType);
  return { privateKey, publicKey: steem.auth.wifToPublic(privateKey) };
}

function expectedPublicKey(account: SteemAccount, role: PasswordAuthRole): string | undefined {
  if (role === 'memo') return account.memo_key || undefined;
  return account[role]?.key_auths?.[0]?.[0];
}

function buildRotatedAuthority(
  source: unknown,
  newPublicKey: string
): { weight_threshold: number; account_auths: [string, number][]; key_auths: [string, number][] } {
  const base = steem.auth.normalizeAuthoritySource(source);
  return {
    weight_threshold: base.weight_threshold,
    account_auths: base.account_auths,
    key_auths: [[newPublicKey, base.weight_threshold]],
  };
}

/**
 * Resolve the owner private key that can sign a full password rotation.
 * Throws when the supplied secret does not match the account's owner authority.
 */
export function resolveOwnerSigningKey(
  account: SteemAccount,
  currentPassword: string
): string {
  const ownerPub = expectedPublicKey(account, 'owner');
  if (!ownerPub) {
    throw new Error('Missing Owner Authority');
  }

  const { privateKey, publicKey } = derivePrivateKeyFromAuth(account.name, 'owner', currentPassword);
  if (publicKey !== ownerPub) {
    throw new Error('Incorrect Password');
  }
  return privateKey;
}

/** Build the account_update operation and signing key for a master-password rotation. */
export function buildAccountUpdateForPasswordChange(
  account: SteemAccount,
  currentPassword: string,
  newMasterPassword: string
): { operation: Operation; signingKey: string } {
  const signingKey = resolveOwnerSigningKey(account, currentPassword);
  const accountName = account.name;

  const rawOperation: Operation = [
    'account_update',
    {
      account: accountName,
      owner: buildRotatedAuthority(
        account.owner,
        steem.auth.wifToPublic(steem.auth.toWif(accountName, newMasterPassword, 'owner'))
      ),
      active: buildRotatedAuthority(
        account.active,
        steem.auth.wifToPublic(steem.auth.toWif(accountName, newMasterPassword, 'active'))
      ),
      posting: buildRotatedAuthority(
        account.posting,
        steem.auth.wifToPublic(steem.auth.toWif(accountName, newMasterPassword, 'posting'))
      ),
      memo_key: steem.auth.wifToPublic(steem.auth.toWif(accountName, newMasterPassword, 'memo')),
      json_metadata: steem.auth.normalizeChainJsonMetadata(account.json_metadata),
    },
  ];

  return {
    operation: steem.auth.normalizeOperationForBroadcast(rawOperation) as Operation,
    signingKey,
  };
}

/** Validate that the current password matches all authority roles (legacy parity). */
export function verifyCurrentPasswordMatchesAccount(
  account: SteemAccount,
  currentPassword: string
): boolean {
  try {
    resolveOwnerSigningKey(account, currentPassword);
    for (const role of AUTHORITY_ROLES) {
      const expected = expectedPublicKey(account, role);
      if (!expected) continue;
      const { publicKey } = derivePrivateKeyFromAuth(account.name, role, currentPassword);
      if (publicKey !== expected) return false;
    }
    const memoExpected = expectedPublicKey(account, 'memo');
    if (memoExpected) {
      const { publicKey } = derivePrivateKeyFromAuth(account.name, 'memo', currentPassword);
      if (publicKey !== memoExpected) return false;
    }
    return true;
  } catch {
    return false;
  }
}
