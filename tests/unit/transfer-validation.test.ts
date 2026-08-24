import { describe, expect, it } from 'vitest';
import {
  validateAccountName,
  validateMemoField,
  isVerifiedExchange,
  isBadActor,
  exchangeRequiresMemo,
  findSimilarExchange,
} from '@/lib/wallet/transfer-validation';

describe('validateAccountName (legacy ChainValidation parity)', () => {
  it('rejects empty / too short / too long names', () => {
    expect(validateAccountName('')).toBe('account_name_should_not_be_empty');
    expect(validateAccountName('ab')).toBe('account_name_should_be_longer');
    expect(validateAccountName('a'.repeat(17))).toBe('account_name_should_be_shorter');
  });

  it('enforces segment rules', () => {
    expect(validateAccountName('1abc')).toBe('each_account_segment_should_start_with_a_letter');
    expect(validateAccountName('ab_cd')).toBe(
      'each_account_segment_should_have_only_letters_digits_or_dashes'
    );
    expect(validateAccountName('abc--def')).toBe(
      'each_account_segment_should_have_only_one_dash_in_a_row'
    );
    expect(validateAccountName('abc-')).toBe(
      'each_account_segment_should_end_with_a_letter_or_digit'
    );
    expect(validateAccountName('abc.de')).toBe('each_account_segment_should_be_longer');
  });

  it('accepts valid names', () => {
    expect(validateAccountName('ety001')).toBeNull();
    expect(validateAccountName('abc-def.ghi')).toBeNull();
  });

  it('flags bad actors unless exchange validation is on', () => {
    expect(isBadActor('poloniexwallet')).toBe(true);
    expect(validateAccountName('poloniexwallet')).toBe('badactor');
    expect(validateAccountName('poloniexwallet', true)).toBeNull();
  });
});

describe('exchange detection', () => {
  it('detects verified exchanges', () => {
    expect(isVerifiedExchange('bittrex')).toBe(true);
    expect(isVerifiedExchange('poloniex')).toBe(true);
    expect(isVerifiedExchange('ety001')).toBe(false);
  });

  it('requires memo for verified exchanges', () => {
    expect(exchangeRequiresMemo('bittrex', '')).toBe(true);
    expect(exchangeRequiresMemo('bittrex', 'memo')).toBe(false);
    expect(exchangeRequiresMemo('ety001', '')).toBe(false);
  });

  it('flags names similar to a verified exchange', () => {
    const result = findSimilarExchange('bittrexx');
    expect(result).not.toBeNull();
    expect(result?.exchange).toBe('bittrex');
    expect(result?.similarity ?? 0).toBeGreaterThanOrEqual(70);
  });

  it('does not flag exact exchanges or unrelated names', () => {
    expect(findSimilarExchange('bittrex')).toBeNull();
    expect(findSimilarExchange('ety001')).toBeNull();
  });
});

describe('validateMemoField', () => {
  it('detects WIF-like strings in memos', () => {
    expect(validateMemoField('hello 5JRandomKeyLookAlikeAbcdEfghIjklMnorPqrst12345')).toBe(
      'memo_has_privatekey'
    );
    expect(validateMemoField('normal memo')).toBeNull();
  });
});
