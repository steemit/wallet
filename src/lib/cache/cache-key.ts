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
