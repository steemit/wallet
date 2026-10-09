import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  hashedCacheKey,
  hashedUserCachePrefix,
  normalizeAccountForCache,
} from '@/lib/cache/cache-key';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('hashedCacheKey', () => {
  it('is deterministic for identical input', () => {
    expect(hashedCacheKey('pfx', 'alice.wallet')).toBe(hashedCacheKey('pfx', 'alice.wallet'));
  });

  it('keeps the trusted prefix verbatim and hashes every component', () => {
    const key = hashedCacheKey('cache:query:x', 'alice', true, 42);
    const parts = key.split(':');
    expect(parts[0]).toBe('cache');
    expect(parts[1]).toBe('query');
    expect(parts[2]).toBe('x');
    expect(parts[3]).toBe(sha('alice'));
    expect(parts[4]).toBe(sha('true'));
    expect(parts[5]).toBe(sha('42'));
  });

  it('regression: an attacker replaying the victim digest gets a DIFFERENT key', () => {
    // The F7 attack: victim username hashed -> digest; attacker submits the
    // digest itself as their input. With the pass-through branch this produced
    // the victim's key verbatim. Now the digest is hashed again, so the keys
    // differ and no collision exists.
    const victim = 'alice.wallet';
    const digest = sha(victim).slice(0, 16); // old truncated form
    const keyVictim = hashedCacheKey('pfx', victim);
    const keyAttacker = hashedCacheKey('pfx', digest);
    expect(keyAttacker).not.toBe(keyVictim);
    // The attacker's digest input is itself hashed: component === sha(digest).
    expect(keyAttacker).toBe(`pfx:${sha(digest)}`);

    // Same with the full digest as attacker input.
    expect(hashedCacheKey('pfx', sha(victim))).not.toBe(keyVictim);
  });

  it('distinct inputs never collide via prefix tricks', () => {
    // "a:b" vs "a" + "b" as separate components must not collide: components
    // are joined by ':' AFTER hashing, and hex digests contain no ':'.
    expect(hashedCacheKey('pfx', 'a:b')).not.toBe(hashedCacheKey('pfx', 'a', 'b'));
    expect(hashedCacheKey('pfx', 'alice.wallet')).not.toBe(hashedCacheKey('pfx', 'alice'));
  });

  it('uses the full 64-hex-char digest (no truncation collision surface)', () => {
    const parts = hashedCacheKey('pfx', 'alice').split(':');
    expect(parts[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never emits Redis-glob or separator metacharacters from components', () => {
    const key = hashedCacheKey('pfx', 'evil*key?[with:new\nlines]');
    const component = key.split(':')[1]!;
    expect(component).toMatch(/^[0-9a-f]+$/);
  });
});

describe('hashedUserCachePrefix (broadcast-side invalidation)', () => {
  // THE regression guard for the 2026-09-21 review finding A-1: broadcast
  // routes deleted by `prefix:${username}` while query routes stored
  // `prefix:<sha256(username)>...`, so every targeted delete was a silent
  // no-op. These tests pin the invalidation prefix to the REAL key
  // construction the query routes use — not an imagined shape.
  it('prefixes every key hashedCacheKey produces for the same account', () => {
    const prefix = hashedUserCachePrefix('cache:query:wallet-estimate-extras', 'alice');
    expect(hashedCacheKey('cache:query:wallet-estimate-extras', 'alice', true).startsWith(prefix)).toBe(true);
    expect(hashedCacheKey('cache:query:wallet-estimate-extras', 'alice', false).startsWith(prefix)).toBe(true);
    // Single-component keys (withdraw-routes) are matched exactly by the
    // trailing-* SCAN pattern cacheDeleteByPrefix applies.
    const single = hashedCacheKey('cache:query:withdraw-routes', 'alice');
    const singlePrefix = hashedUserCachePrefix('cache:query:withdraw-routes', 'alice');
    expect(single.startsWith(singlePrefix)).toBe(true);
  });

  it('never prefixes another account key', () => {
    const prefix = hashedUserCachePrefix('cache:query:wallet-estimate-extras', 'alice');
    expect(hashedCacheKey('cache:query:wallet-estimate-extras', 'bob', true).startsWith(prefix)).toBe(false);
    // A same-length digest with a different first char must not match either.
    const aliceHash = sha('alice');
    const other = (aliceHash[0] === 'a' ? 'b' : 'a') + aliceHash.slice(1);
    expect(`${'cache:query:wallet-estimate-extras'}:${other}`.startsWith(prefix)).toBe(false);
  });

  it('normalizes like the query routes: case and leading @ are irrelevant', () => {
    expect(normalizeAccountForCache('  @Alice.Sub ')).toBe('alice.sub');
    expect(hashedUserCachePrefix('pfx', '@Alice.Sub')).toBe(hashedUserCachePrefix('pfx', 'alice.sub'));
  });

  it('emits only the trusted prefix plus hex — no glob metacharacters', () => {
    const prefix = hashedUserCachePrefix('pfx', 'evil*name?[with:chars]');
    expect(prefix.slice('pfx:'.length)).toMatch(/^[0-9a-f]{64}$/);
  });
});
