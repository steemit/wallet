/**
 * Transfer-form account/memo validation, ported from wallet-legacy
 * `utils/ChainValidation.js`. Returns i18n error codes (translated by the
 * caller under the `transfer.errors` namespace) or null when valid.
 */
import { BAD_ACTOR_LIST } from '@/lib/wallet/bad-actor-list';
import { VERIFIED_EXCHANGE_LIST } from '@/lib/wallet/verified-exchange-list';

export type AccountNameErrorCode =
  | 'account_name_should_not_be_empty'
  | 'account_name_should_be_longer'
  | 'account_name_should_be_shorter'
  | 'badactor'
  | 'each_account_segment_should_start_with_a_letter'
  | 'each_account_segment_should_have_only_letters_digits_or_dashes'
  | 'each_account_segment_should_have_only_one_dash_in_a_row'
  | 'each_account_segment_should_end_with_a_letter_or_digit'
  | 'each_account_segment_should_be_longer';

export function validateAccountName(
  value: string,
  exchangeValidation = false
): AccountNameErrorCode | null {
  if (!value) return 'account_name_should_not_be_empty';
  if (value.length < 3) return 'account_name_should_be_longer';
  if (value.length > 16) return 'account_name_should_be_shorter';
  if (!exchangeValidation && BAD_ACTOR_LIST.includes(value)) return 'badactor';
  const segments = value.split('.');
  for (const label of segments) {
    if (!/^[a-z]/.test(label)) return 'each_account_segment_should_start_with_a_letter';
    if (!/^[a-z0-9-]*$/.test(label))
      return 'each_account_segment_should_have_only_letters_digits_or_dashes';
    if (/--/.test(label))
      return 'each_account_segment_should_have_only_one_dash_in_a_row';
    if (!/[a-z0-9]$/.test(label))
      return 'each_account_segment_should_end_with_a_letter_or_digit';
    if (label.length < 3) return 'each_account_segment_should_be_longer';
  }
  return null;
}

/** True when the name is a verified exchange or known bad actor (legacy
 * `validate_exchange_account_with_memo`). Only relevant for direct transfers. */
export function isExchangeOrBadActor(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return VERIFIED_EXCHANGE_LIST.includes(lower) || BAD_ACTOR_LIST.includes(lower);
}

export function isVerifiedExchange(name: string): boolean {
  return VERIFIED_EXCHANGE_LIST.includes(name.trim().toLowerCase());
}

export function isBadActor(name: string): boolean {
  return BAD_ACTOR_LIST.includes(name.trim().toLowerCase());
}

/** Legacy `validate_account_name_with_memo`: verified exchanges require a memo. */
export function exchangeRequiresMemo(name: string, memo: string): boolean {
  return isVerifiedExchange(name) && !memo.trim();
}

/** Legacy `validate_memo_field` (key leak detection, WIF patterns only). */
export type MemoErrorCode = 'memo_has_privatekey' | 'memo_is_privatekey';

export function validateMemoField(value: string): MemoErrorCode | null {
  const words = value.split(' ').filter((w) => w !== '');
  for (const word of words) {
    // Only perform key tests if it might be a key, i.e. it is a long string.
    if (word.length >= 39) {
      if (/5[HJK]\w{40,45}/i.test(word)) return 'memo_has_privatekey';
      if (/^5[1-9A-HJ-NP-Za-km-z]{50,51}$/.test(word)) return 'memo_is_privatekey';
    }
  }
  return null;
}

/**
 * Suspicious-account detection (legacy `checkExchangeStatus`): fuzzy-match the
 * recipient against the verified exchange list. Returns the closest exchange
 * name and a similarity percentage when the score reaches the legacy
 * threshold (>= 70).
 */
export function findSimilarExchange(
  name: string
): { exchange: string; similarity: number } | null {
  const input = name.trim().toLowerCase();
  if (!input || VERIFIED_EXCHANGE_LIST.includes(input)) return null;

  let best: { exchange: string; similarity: number } | null = null;
  for (const target of VERIFIED_EXCHANGE_LIST) {
    const score = combinedSimilarity(input, target);
    if (best === null || score > best.similarity) {
      best = { exchange: target, similarity: score };
    }
  }
  return best && best.similarity >= 70 ? best : null;
}

/** Normalized edit-distance similarity in [0, 100]. */
function combinedSimilarity(input: string, target: string): number {
  const distance = levenshtein(input, target);
  const maxLen = Math.max(input.length, target.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - distance / maxLen) * 100);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}
