/**
 * Shared account-name normalization semantics (@/lib/steem/username).
 *
 * These helpers back every username comparison and every username-bearing
 * cache key in the app; the regression tests here pin the exact canonical
 * form so client comparisons and server cache keys cannot drift apart.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSteemUsername,
  sameSteemAccount,
} from '@/lib/steem/username';

describe('normalizeSteemUsername', () => {
  it('lowercases, trims, and strips a single leading @', () => {
    expect(normalizeSteemUsername('Alice')).toBe('alice');
    expect(normalizeSteemUsername('  @Alice  ')).toBe('alice');
    expect(normalizeSteemUsername('@Alice.Sub-01')).toBe('alice.sub-01');
  });

  it('strips every leading @', () => {
    expect(normalizeSteemUsername('@@Alice')).toBe('alice');
  });

  it('is idempotent', () => {
    const once = normalizeSteemUsername('  @Alice ');
    expect(normalizeSteemUsername(once)).toBe(once);
  });

  it('matches the server-side cache-key normalizer exactly', async () => {
    const { normalizeAccountForCache } = await import('@/lib/cache/cache-key');
    for (const input of ['Alice', '@Alice', '  @Alice.Sub ', 'bob', '@@x']) {
      expect(normalizeAccountForCache(input)).toBe(normalizeSteemUsername(input));
    }
  });
});

describe('sameSteemAccount', () => {
  it('treats case, whitespace, and leading @ as irrelevant', () => {
    expect(sameSteemAccount('alice', 'Alice')).toBe(true);
    expect(sameSteemAccount(' @Alice ', 'alice')).toBe(true);
    expect(sameSteemAccount('Alice.Sub', '@alice.sub')).toBe(true);
  });

  it('distinguishes different accounts', () => {
    expect(sameSteemAccount('alice', 'bob')).toBe(false);
    expect(sameSteemAccount('alice', 'alicia')).toBe(false);
  });

  it('returns false for null/undefined/empty operands', () => {
    expect(sameSteemAccount(null, 'alice')).toBe(false);
    expect(sameSteemAccount('alice', undefined)).toBe(false);
    expect(sameSteemAccount('', 'alice')).toBe(false);
    expect(sameSteemAccount('alice', '')).toBe(false);
    expect(sameSteemAccount(null, null)).toBe(false);
  });
});
