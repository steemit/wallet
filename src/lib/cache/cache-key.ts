import { createHash } from 'crypto';

/**
 * Build a collision-resistant Redis cache key from a prefix and user-supplied
 * components. EVERY component is hashed with the full SHA-256 digest so that:
 *   - raw usernames with special chars (`:`, `*`, `\n`) cannot inject into the key,
 *   - distinct inputs cannot share a key — in particular, an attacker cannot
 *     replay a victim's hash digest as their own input (the digest would be
 *     hashed again, yielding a different key). A previous version passed
 *     "safe-looking" short strings through unhashed; because SHA-256 output
 *     (hex) itself matches that safe-looking set, `sha256(victim).slice(0,16)`
 *     passed through unchanged and collided with the victim's hashed key
 *     (cross-account cache poisoning). Hence: no pass-through branch, ever.
 *
 * Use this instead of string-interpolating user input directly into cache keys.
 * The prefix is a trusted code constant and is kept verbatim for greppability.
 */
export function hashedCacheKey(prefix: string, ...parts: (string | number | boolean)[]): string {
  const segments = parts.map((p) => {
    const digest = createHash('sha256').update(String(p)).digest('hex');
    return digest;
  });
  return [prefix, ...segments].join(':');
}

/**
 * Normalize an account name the same way every query route does before it
 * builds a cache key. Steem names are case-insensitive on chain and callers
 * pass them with or without a leading '@', so both the write side (query
 * routes) and the delete side (broadcast routes) must hash this exact form —
 * otherwise the same account produces different digests and invalidation
 * never matches.
 */
export function normalizeAccountForCache(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Prefix covering every cache key `hashedCacheKey(prefix, username, ...)`
 * can produce for ONE account. Broadcast routes know only the account name —
 * not the extra key parts a query route adds (e.g. includeOpenOrders) — so
 * they delete by this prefix and let cacheDeleteByPrefix's trailing `*`
 * cover the rest: `<prefix>:<sha256(normalized)>` matches both
 * `<prefix>:<sha256(normalized)>` and `<prefix>:<sha256(normalized)>:<more>`.
 *
 * The digest is pure hex, so no Redis glob metacharacter can be smuggled in
 * via the username (unlike interpolating the raw name into the SCAN pattern).
 * Pass the result to cacheDeleteByPrefix (which applies the REDIS_KEY_PREFIX
 * and appends the trailing `*`).
 */
export function hashedUserCachePrefix(prefix: string, username: string): string {
  return `${prefix}:${createHash('sha256').update(normalizeAccountForCache(username)).digest('hex')}`;
}
