/**
 * Owner-history key matching shared by the recovery frontend pages.
 *
 * The relay server (broadcast/recover-account) validates the historical owner
 * proof against the FULL key set of every owner authority in the history
 * (`previous_owner_authority.key_auths`). These helpers mirror that client
 * side for UX prechecks — checking only `key_auths[0][0]` wrongly rejects
 * multi-key owner authorities (a user holding the 2nd key is legitimate).
 *
 * Kept dependency-free and server-safe so it can be reused by any future
 * client-side key-set checks (login's first-key-only comparison is a known
 * separate limitation and is NOT addressed here).
 */
import type { OwnerHistoryEntry } from '@/lib/steem/types';

/** All public keys in one authority's key set (`[key, weight]` tuples). */
export function authorityKeySet(keyAuths: [string, number][] | undefined): string[] {
  return (keyAuths ?? [])
    .map((entry) => (Array.isArray(entry) ? entry[0] : undefined))
    .filter((key): key is string => typeof key === 'string');
}

/**
 * Whether the public key belongs to ANY key of ANY previous owner authority
 * in the account's on-chain owner history (server-authoritative semantics).
 */
export function ownerHistoryContainsKey(
  history: OwnerHistoryEntry[],
  publicKey: string
): boolean {
  return history.some((entry) =>
    authorityKeySet(entry.previous_owner_authority?.key_auths).includes(publicKey)
  );
}
