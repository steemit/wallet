import { describe, expect, it } from 'vitest';
import { parseSteemAsset, formatSteemAssetString } from '@/lib/steem/parse-asset';

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

describe('formatSteemAssetString', () => {
  it('renders NAI asset objects in the legacy string form', () => {
    // Real production shape from
    // database_api.find_vesting_delegation_expirations (@@000000037 = VESTS).
    expect(
      formatSteemAssetString(
        { amount: '5971304284', nai: '@@000000037', precision: 6 },
        'VESTS'
      )
    ).toBe('5971.304284 VESTS');
    expect(
      formatSteemAssetString(
        { amount: '41193378484', nai: '@@000000037', precision: 6 },
        'VESTS'
      )
    ).toBe('41193.378484 VESTS');
  });

  it('keeps exactness for amounts beyond Number.MAX_SAFE_INTEGER', () => {
    // 9007199254740993 = 2^53 + 1: plain number math rounds it to 2^53
    // and the float division loses the final digit (…992 instead of …993).
    const amount = '9007199254740993';
    expect(formatSteemAssetString({ amount, precision: 6 }, 'VESTS')).toBe(
      '9007199254.740993 VESTS'
    );
    expect(String(Number(amount) / 10 ** 6)).toBe('9007199254.740992');
  });

  it('passes legacy-form strings through unchanged', () => {
    expect(formatSteemAssetString('82547.602366 VESTS', 'VESTS')).toBe('82547.602366 VESTS');
  });

  it('pads short amounts to the asset precision', () => {
    expect(formatSteemAssetString({ amount: '42', precision: 6 }, 'VESTS')).toBe(
      '0.000042 VESTS'
    );
    expect(formatSteemAssetString({ amount: 7, precision: 0 }, 'STEEM')).toBe('7 STEEM');
  });

  it('degrades malformed input to a zero asset', () => {
    expect(formatSteemAssetString(null, 'VESTS')).toBe('0 VESTS');
    expect(formatSteemAssetString(undefined, 'VESTS')).toBe('0 VESTS');
    expect(formatSteemAssetString(12, 'VESTS')).toBe('0 VESTS');
    expect(formatSteemAssetString({ amount: 'abc', precision: 6 }, 'VESTS')).toBe('0 VESTS');
    expect(formatSteemAssetString({ precision: 6 }, 'VESTS')).toBe('0 VESTS');
    expect(formatSteemAssetString({ amount: '-5', precision: 6 }, 'VESTS')).toBe('0 VESTS');
  });
});

