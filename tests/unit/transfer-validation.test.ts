// @vitest-environment node
// Node environment (not jsdom): the memo_is_password tests exercise the real
// steem-js crypto through the test mock, and steem-js hashing fails in the
// jsdom realm (node Buffer vs jsdom Uint8Array instanceof mismatch).
import { describe, expect, it } from 'vitest';
// Aliased to tests/mocks/steem-js.ts in vitest, which proxies the real
// PrivateKey class — used to derive fixtures with the legacy seed path.
import { steem } from '@steemit/steem-js';
import {
  validateAccountName,
  validateMemoField,
  isVerifiedExchange,
  isBadActor,
  exchangeRequiresMemo,
  findSimilarExchange,
  parseTransferAmountInput,
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

  // Legacy wallet-legacy src/app/utils/ChainValidation.js:100-107
  // (`validate_memo_field`): derives the memo public key from
  // `PrivateKey.fromSeed(username + 'memo' + word)` and compares it to the
  // account's memo_key — a match means the word IS the account's master
  // password. Fixture keys below were derived with the same real steem-js
  // crypto. The fixture password deliberately avoids the WIF-looking pattern
  // (no '5' followed by H/J/K + 40-45 word chars) so the password branch, not
  // the WIF branch, is what fires.
  const USERNAME = 'parityuser';
  const MASTER_PASSWORD = 'Q7mZpK2vN9yRtWxLcD8sHbG4uJfAeOi3BqMwYrK1dVzXt'; // 45 chars
  const MEMO_KEY = 'STM8Qwm6Nx1gGbRkfsSzy9oevyPS3ThyYKAL5ZWDu6gqPnbs9EcJa';
  const OTHER_KEY = 'STM8bdra1r2ePBQabgos4JbzAUPU1pkzeB4tGcmz1GYShvB6sbeEQ';

  it('detects the master password pasted into the memo', () => {
    expect(validateMemoField(MASTER_PASSWORD, USERNAME, MEMO_KEY)).toBe(
      'memo_is_password'
    );
    // The password can appear among other words, like legacy.
    expect(
      validateMemoField(`payment for invoice ${MASTER_PASSWORD} thanks`, USERNAME, MEMO_KEY)
    ).toBe('memo_is_password');
  });

  it('does not flag a long word that derives a different key', () => {
    expect(
      validateMemoField(MASTER_PASSWORD, USERNAME, OTHER_KEY)
    ).toBeNull();
    // Different username derives a different key from the same password.
    expect(
      validateMemoField(MASTER_PASSWORD, 'otheruser', MEMO_KEY)
    ).toBeNull();
  });

  it('skips the password check when account info is unavailable', () => {
    // Backward-compatible call shape (no username/memoKey): only WIF checks run.
    expect(validateMemoField(MASTER_PASSWORD)).toBeNull();
    expect(validateMemoField(MASTER_PASSWORD, USERNAME)).toBeNull();
    expect(validateMemoField(MASTER_PASSWORD, undefined, MEMO_KEY)).toBeNull();
  });

  it('gates key tests on word length like legacy (>= 39 chars)', () => {
    // Master passwords under 39 chars are not tested (legacy gating).
    const shortPassword = 'P5' + 'x'.repeat(30); // 32 chars, same seed path
    const derived = steem.auth.PrivateKey.fromSeed(USERNAME + 'memo' + shortPassword)
      .toPublicKey()
      .toString();
    expect(validateMemoField(shortPassword, USERNAME, derived)).toBeNull();
  });

  it('still returns the WIF errors ahead of the password check', () => {
    expect(
      validateMemoField('5JRandomKeyLookAlikeAbcdEfghIjklMnorPqrst12345', USERNAME, MEMO_KEY)
    ).toBe('memo_has_privatekey');
  });
});

describe('parseTransferAmountInput (G-14: strict syntax + 3-decimal parity)', () => {
  it('rejects multi-dot inputs the old /^[\\d.]+$/ regex passed', () => {
    // Old behavior: "1.2.3" matched, parseFloat silently truncated to 1.2.
    expect(parseTransferAmountInput('1.2.3')).toEqual({
      ok: false,
      issue: 'invalid_amount',
    });
    expect(parseTransferAmountInput('1.2.3.4')).toEqual({ ok: false, issue: 'invalid_amount' });
  });

  it('rejects non-numeric and malformed input', () => {
    for (const bad of ['', 'abc', '-1', '1e3', '.5', '5.', '1,000', '$5', '1 2']) {
      expect(parseTransferAmountInput(bad)).toEqual({ ok: false, issue: 'invalid_amount' });
    }
  });

  it('rejects zero and negative-equivalent values', () => {
    expect(parseTransferAmountInput('0')).toEqual({ ok: false, issue: 'amount_must_be_positive' });
    expect(parseTransferAmountInput('0.000')).toEqual({
      ok: false,
      issue: 'amount_must_be_positive',
    });
  });

  it('rejects more than 3 decimal places explicitly (power-up parity)', () => {
    expect(parseTransferAmountInput('1.0005')).toEqual({ ok: false, issue: 'precision_error' });
    expect(parseTransferAmountInput('0.1234')).toEqual({ ok: false, issue: 'precision_error' });
  });

  it('accepts valid amounts with identical semantics to before', () => {
    expect(parseTransferAmountInput('1')).toEqual({ ok: true, value: 1 });
    expect(parseTransferAmountInput('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(parseTransferAmountInput('1.001')).toEqual({ ok: true, value: 1.001 });
    expect(parseTransferAmountInput('0.123')).toEqual({ ok: true, value: 0.123 });
    // Trailing whitespace was tolerated by the old regex and still is.
    expect(parseTransferAmountInput('1.5 ')).toEqual({ ok: true, value: 1.5 });
  });
});
