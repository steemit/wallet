import { SteemSigner } from '@/lib/steem/client';
import type { SteemAccount } from '@/lib/steem/types';

export type AccountAuthType = 'posting' | 'active' | 'owner' | 'memo';

export interface AuthRoleKeys {
  ownerKey: string | null;
  activeKey: string | null;
  postingKey: string | null;
  memoKey: string | null;
}

/** Public keys for an authority type (memo is a single key). */
export function getPublicKeysForAuth(
  account: SteemAccount,
  authType: AccountAuthType
): string[] {
  if (authType === 'memo') {
    return account.memo_key ? [account.memo_key] : [];
  }
  const auths = account[authType]?.key_auths;
  if (!Array.isArray(auths)) return [];
  return auths.map(([pub]) => pub).filter((pub): pub is string => Boolean(pub));
}

/** WIF that matches `pubkey`, if any role key in memory corresponds. */
export function wifForPublicKey(pubkey: string, keys: AuthRoleKeys): string | undefined {
  const candidates = [keys.ownerKey, keys.activeKey, keys.postingKey, keys.memoKey];
  for (const wif of candidates) {
    if (!wif) continue;
    try {
      if (SteemSigner.privateKeyToPublicKey(wif) === pubkey) return wif;
    } catch {
      // ignore invalid WIF
    }
  }
  return undefined;
}

/** Role-specific private key from Redux (may not match account pubkey until login). */
export function privateKeyForAuthType(
  authType: AccountAuthType,
  keys: AuthRoleKeys
): string | null {
  switch (authType) {
    case 'owner':
      return keys.ownerKey;
    case 'active':
      return keys.activeKey;
    case 'posting':
      return keys.postingKey;
    case 'memo':
      return keys.memoKey;
    default:
      return null;
  }
}
