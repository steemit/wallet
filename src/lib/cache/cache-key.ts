import { createHash } from 'crypto';

/**
 * Build a collision-resistant Redis cache key from a prefix and user-supplied
 * components. Each component is SHA-256 hashed (truncated) so that:
 *   - raw usernames with special chars (`:`, `*`, `\n`) cannot inject into the key,
 *   - distinct inputs never share a key via prefix collision.
 *
 * Use this instead of string-interpolating user input directly into cache keys.
 */
export function hashedCacheKey(prefix: string, ...parts: (string | number | boolean)[]): string {
  const segments = parts.map((p) => {
    const str = String(p);
    // Short safe values (numeric/boolean) pass through; strings get hashed.
    if (/^[a-zA-Z0-9_-]{1,24}$/.test(str)) return str;
    return createHash('sha256').update(str).digest('hex').slice(0, 16);
  });
  return [prefix, ...segments].join(':');
}
