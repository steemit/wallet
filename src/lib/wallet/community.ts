import { steem } from '@steemit/steem-js';
import type { Operation } from '@/lib/steem/types';

// Cryptographically strong entropy for generated community names/passwords.
function cryptoRandomHex(bytes: number): string {
  // Prefer Node/undici webcrypto; fall back to window.crypto when available.
  const c =
    typeof globalThis !== 'undefined' &&
    (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(bytes);
    c.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Should not happen in a browser or Node runtime; avoid Math.random fallback.
  throw new Error('secure entropy source unavailable');
}

export const COMMUNITY_CREATE_FEE = '3.000 STEEM';
export const COMMUNITY_TITLE_MAX_LENGTH = 32;
export const COMMUNITY_DESCRIPTION_MAX_LENGTH = 120;
export const DEFAULT_SOCIAL_URL = 'https://steemit.com';

type AuthRole = 'owner' | 'active' | 'posting' | 'memo';

type KeyAuthority = {
  weight_threshold: number;
  account_auths: [string, number][];
  key_auths: [string, number][];
};

export type AccountCreateOperationPayload = {
  fee: string;
  creator: string;
  new_account_name: string;
  owner: KeyAuthority;
  active: KeyAuthority;
  posting: KeyAuthority;
  memo_key: string;
  json_metadata: string;
};

/** Generate a hive-XXXXXX style community account name (legacy wallet-legacy parity). */
export function generateCommunityOwnerName(): string {
  // Use a strong random in the same 100000–199999 range.
  const c =
    typeof globalThis !== 'undefined' &&
    (globalThis as { crypto?: Crypto }).crypto;
  const rand =
    c && typeof c.getRandomValues === 'function'
      ? c.getRandomValues(new Uint32Array(1))[0]!
      : 0;
  return `hive-${(rand % 100000) + 100000}`;
}

/** Generate a random owner password prefixed with P (legacy wallet-legacy parity). */
export function generateCommunityOwnerPassword(): string {
  const entropy = `${Date.now()}-${cryptoRandomHex(16)}`;
  return `P${steem.auth.getPrivateKey(entropy)}`;
}

/** Title must start with a Unicode letter (legacy Unicode.L check). */
export function communityTitleStartsWithLetter(title: string): boolean {
  if (!title) return false;
  return /^\p{L}/u.test(title);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateAuth(
  accountName: string,
  ownerPassword: string,
  role: AuthRole
): KeyAuthority | string {
  const keys = steem.auth.getPrivateKeys(accountName, ownerPassword, [role]);
  const wif = Object.values(keys)[0];
  if (!wif) {
    throw new Error(`Failed to derive ${role} key for ${accountName}`);
  }
  const publicKey = steem.auth.wifToPublic(wif);
  if (role === 'memo') return publicKey;
  return {
    weight_threshold: 1,
    account_auths: [],
    key_auths: [[publicKey, 1]],
  };
}

export function buildAccountCreateOperation(
  creator: string,
  communityOwnerName: string,
  communityOwnerPassword: string
): AccountCreateOperationPayload {
  return {
    fee: COMMUNITY_CREATE_FEE,
    creator,
    new_account_name: communityOwnerName,
    owner: generateAuth(communityOwnerName, communityOwnerPassword, 'owner') as KeyAuthority,
    active: generateAuth(communityOwnerName, communityOwnerPassword, 'active') as KeyAuthority,
    posting: generateAuth(communityOwnerName, communityOwnerPassword, 'posting') as KeyAuthority,
    memo_key: generateAuth(communityOwnerName, communityOwnerPassword, 'memo') as string,
    json_metadata: '',
  };
}

export function buildHivemindCommunityOperation(
  actorName: string,
  action: string,
  params: Record<string, unknown>
): Operation {
  return [
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [actorName],
      id: 'community',
      json: JSON.stringify([action, params]),
    },
  ];
}

export function buildCommunitySetupOperations(
  accountName: string,
  communityOwnerName: string,
  communityTitle: string,
  communityDescription: string
): Operation[] {
  return [
    buildHivemindCommunityOperation(communityOwnerName, 'setRole', {
      community: communityOwnerName,
      account: accountName,
      role: 'admin',
    }),
    buildHivemindCommunityOperation(communityOwnerName, 'updateProps', {
      community: communityOwnerName,
      props: {
        title: communityTitle,
        about: communityDescription,
      },
    }),
  ];
}

export function buildCommunitySubscribeOperation(
  accountName: string,
  communityOwnerName: string
): Operation {
  return buildHivemindCommunityOperation(accountName, 'subscribe', {
    community: communityOwnerName,
  });
}

/** Active WIF for the new community account (signs hivemind setRole / updateProps). */
export function communityActiveWif(
  communityOwnerName: string,
  communityOwnerPassword: string
): string {
  return steem.auth.toWif(communityOwnerName, communityOwnerPassword, 'active');
}

export function communityTrendingUrl(
  socialUrl: string,
  communityOwnerName: string
): string {
  const base = socialUrl.replace(/\/$/, '');
  return `${base}/trending/${communityOwnerName}`;
}
