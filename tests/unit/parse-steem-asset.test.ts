import { describe, expect, it } from 'vitest';
import { parseSteemAsset } from '@/lib/steem/parse-asset';

describe('parseSteemAsset', () => {
  it('parses string assets', () => {
    expect(parseSteemAsset('1.234 SBD')).toBe(1.234);
    expect(parseSteemAsset('1000000.000000 VESTS')).toBe(1_000_000);
  });

  it('parses object assets', () => {
    expect(parseSteemAsset({ amount: '1234', precision: 3, nai: '@@000000013' })).toBe(1.234);
    expect(parseSteemAsset({ amount: 5000, precision: 3 })).toBe(5);
  });

  it('handles nullish and invalid shapes', () => {
    expect(parseSteemAsset(null)).toBe(0);
    expect(parseSteemAsset(undefined)).toBe(0);
    expect(parseSteemAsset(true)).toBe(0);
    expect(parseSteemAsset({ precision: 3 })).toBe(0);
  });
});

