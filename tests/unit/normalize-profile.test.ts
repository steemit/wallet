/**
 * normalizeProfile — sanitize account profile metadata from chain data
 * (posting_json_metadata with json_metadata fallback, legacy parity).
 */
import { describe, it, expect } from 'vitest';
import { normalizeProfile } from '@/lib/steem/normalize-profile';

describe('normalizeProfile', () => {
  it('returns all-undefined for a null account', () => {
    expect(normalizeProfile(null)).toEqual({
      name: undefined,
      about: undefined,
      location: undefined,
      website: undefined,
      profile_image: undefined,
      cover_image: undefined,
    });
  });

  it('reads the profile block from posting_json_metadata', () => {
    const out = normalizeProfile({
      posting_json_metadata: JSON.stringify({
        profile: { name: 'Alice', about: 'hi', location: 'earth', website: 'example.com' },
      }),
    });
    expect(out.name).toBe('Alice');
    expect(out.about).toBe('hi');
    expect(out.location).toBe('earth');
    expect(out.website).toBe('http://example.com/');
  });

  it('falls back to json_metadata when posting_json_metadata has no profile', () => {
    const out = normalizeProfile({
      posting_json_metadata: JSON.stringify({ no_profile: true }),
      json_metadata: JSON.stringify({ profile: { name: 'Legacy' } }),
    });
    expect(out.name).toBe('Legacy');
  });

  it('treats invalid JSON and non-object payloads as empty', () => {
    expect(normalizeProfile({ posting_json_metadata: 'not json{' }).name).toBeUndefined();
    expect(normalizeProfile({ posting_json_metadata: '"just a string"' }).about).toBeUndefined();
    expect(
      normalizeProfile({ posting_json_metadata: JSON.stringify({ profile: [1, 2] }) }).name
    ).toBeUndefined();
  });

  it('truncates long fields with an ellipsis', () => {
    const out = normalizeProfile({
      posting_json_metadata: JSON.stringify({
        profile: {
          name: 'A'.repeat(30),
          about: 'B'.repeat(200),
          location: 'C'.repeat(40),
        },
      }),
    });
    expect(out.name).toBe('A'.repeat(19) + '...');
    expect(out.about).toBe('B'.repeat(159) + '...');
    expect(out.location).toBe('C'.repeat(29) + '...');
  });

  it('drops names that start with @ and empty strings', () => {
    const out = normalizeProfile({
      posting_json_metadata: JSON.stringify({
        profile: { name: '@ impostor', about: '  ' },
      }),
    });
    expect(out.name).toBeUndefined();
    expect(out.about).toBeUndefined();
  });

  it('normalizes websites and rejects unusable ones', () => {
    const mk = (website: string) =>
      normalizeProfile({ posting_json_metadata: JSON.stringify({ profile: { website } }) });

    expect(mk('https://good.example').website).toBe('https://good.example/');
    expect(mk('plain.example').website).toBe('http://plain.example/');
    // Non-http schemes are coerced onto http (legacy parity), not dropped.
    expect(mk('ftp://bad.example').website).toMatch(/^http:/);
    expect(mk('x'.repeat(120)).website).toBeUndefined();
    expect(mk('::::').website).toBeUndefined();
  });

  it('only accepts http(s) image URLs verbatim', () => {
    const out = normalizeProfile({
      posting_json_metadata: JSON.stringify({
        profile: {
          profile_image: 'https://img.example/a.png',
          cover_image: 'javascript:alert(1)',
        },
      }),
    });
    expect(out.profile_image).toBe('https://img.example/a.png');
    expect(out.cover_image).toBeUndefined();
  });
});
