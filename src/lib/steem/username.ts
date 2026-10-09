/**
 * Canonical Steem account-name normalization and comparison.
 *
 * Steem account names are case-insensitive on chain and canonically lowercase,
 * but the same account reaches this app through many channels — URL path
 * (`/@Alice`), login form input, the Redux session user, chain RPC fields —
 * with inconsistent case and an optional leading '@'. Every username
 * comparison and every username-bearing cache key (client and server) MUST go
 * through these helpers; a raw `===` against a URL-derived name is the known
 * source of "logged in but the wallet treats me as a visitor" bugs.
 *
 * This module is pure (no browser or Node APIs) so client components and
 * server route handlers import the SAME implementation. The server-side
 * cache-key normalizer (`normalizeAccountForCache` in @/lib/cache/cache-key)
 * delegates here, keeping write-side and delete-side invalidation consistent.
 */

/**
 * Canonical form of an account name: trimmed, lowercased, leading '@'s
 * stripped ("  @Alice " -> "alice").
 */
export function normalizeSteemUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

/**
 * Case- and '@'-insensitive equality of two account names.
 * Returns false when either side is null/undefined/empty.
 */
export function sameSteemAccount(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return normalizeSteemUsername(a) === normalizeSteemUsername(b);
}
