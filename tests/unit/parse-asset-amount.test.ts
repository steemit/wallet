/**
 * parseAssetAmount unit tests
 *
 * The function is small but it sits under every wallet display + estimation:
 * a wrong return here silently corrupts the displayed balance, the estimated
 * USD value, and the power-down progress bar. The table below pins down both
 * the supported shapes and the rejected ones (negatives, leading whitespace,
 * "$" prefix) so behavior changes can't slip in unnoticed.
 */

import { describe, it, expect } from 'vitest';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';

describe('parseAssetAmount', () => {
  it.each<{ label: string; input: string | undefined; expected: number }>([
    { label: 'STEEM with three decimals',     input: '12.345 STEEM',          expected: 12.345 },
    { label: 'SBD with three decimals',       input: '0.500 SBD',             expected: 0.5 },
    { label: 'VESTS with six decimals',       input: '1000000.000000 VESTS',  expected: 1000000 },
    { label: 'zero amount',                   input: '0.000 STEEM',           expected: 0 },
    { label: 'integer with no decimals',      input: '100 STEEM',             expected: 100 },
    { label: 'leading dot',                   input: '.5 STEEM',              expected: 0.5 },
    { label: 'digits followed by junk',       input: '1.234abc',              expected: 1.234 },
    { label: 'multiple dots (parseFloat truncates)', input: '1.234.567 STEEM', expected: 1.234 },
  ])('parses $label → $expected', ({ input, expected }) => {
    expect(parseAssetAmount(input)).toBe(expected);
  });

  describe('falls back to 0', () => {
    it.each<{ label: string; input: string | undefined }>([
      { label: 'undefined',                  input: undefined },
      { label: 'empty string',               input: '' },
      { label: 'pure letters',               input: 'STEEM' },
      // ^[\d.] explicitly rejects '-'; negative balances would parse as 0,
      // which is the safer floor for downstream math (won't double-count debt).
      { label: 'negative sign prefix',       input: '-1.000 STEEM' },
      { label: 'leading whitespace',         input: ' 10.000 STEEM' },
      // Despite the JSDoc claim that "$1.234 SBD" is supported, the regex
      // does not accept a '$' prefix. Locking this in until the regex changes.
      { label: 'dollar-prefixed amount',     input: '$1.234 SBD' },
    ])('$label', ({ input }) => {
      expect(parseAssetAmount(input)).toBe(0);
    });
  });
});
