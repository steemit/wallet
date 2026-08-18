import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { hashedCacheKey } from '@/lib/cache/cache-key';

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
