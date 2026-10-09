/**
 * Unit tests for the shared client-side owner-history key matching.
 *
 * The relay server (broadcast/recover-account) validates the historical
 * owner proof against the FULL key set of every previous owner authority;
 * these tests pin the same semantics for the frontend precheck so multi-key
 * owner accounts are not wrongly rejected.
 */
import { describe, it, expect } from 'vitest';
import { authorityKeySet, ownerHistoryContainsKey } from '@/lib/steem/owner-history';
import type { OwnerHistoryEntry } from '@/lib/steem/types';

const KEY_1 = 'STM5FirstOwnerKey';
const KEY_2 = 'STM6SecondOwnerKey';
const OTHER = 'STM7UnrelatedKey';

const multiKeyHistory: OwnerHistoryEntry[] = [
  {
    previous_owner_authority: {
      key_auths: [
        [KEY_1, 1],
        [KEY_2, 1],
      ],
    },
  },
];

describe('authorityKeySet', () => {
  it('extracts every key from the [key, weight] tuples', () => {
    expect(authorityKeySet(multiKeyHistory[0]!.previous_owner_authority!.key_auths)).toEqual([
      KEY_1,
      KEY_2,
    ]);
  });

  it('drops malformed entries instead of crashing', () => {
    const malformed: [string, number][] = [
      [KEY_1, 1],
      // object-map entry (Array.isArray is false) — dropped defensively
      { 0: KEY_2, 1: 1 } as unknown as [string, number],
    ];
    expect(authorityKeySet(malformed)).toEqual([KEY_1]);
  });

  it('returns an empty array for undefined input', () => {
    expect(authorityKeySet(undefined)).toEqual([]);
  });
});

describe('ownerHistoryContainsKey', () => {
  it('matches the first key (single-key authority)', () => {
    const history: OwnerHistoryEntry[] = [
      { previous_owner_authority: { key_auths: [[KEY_1, 1]] } },
    ];
    expect(ownerHistoryContainsKey(history, KEY_1)).toBe(true);
    expect(ownerHistoryContainsKey(history, OTHER)).toBe(false);
  });

  it('matches ANY key of a multi-key authority (requester holds the 2nd key)', () => {
    expect(ownerHistoryContainsKey(multiKeyHistory, KEY_2)).toBe(true);
    expect(ownerHistoryContainsKey(multiKeyHistory, KEY_1)).toBe(true);
  });

  it('searches across multiple history entries', () => {
    const history: OwnerHistoryEntry[] = [
      { previous_owner_authority: { key_auths: [[KEY_1, 1]] } },
      { previous_owner_authority: { key_auths: [[KEY_2, 1]] } },
    ];
    expect(ownerHistoryContainsKey(history, KEY_2)).toBe(true);
  });

  it('false for an unrelated key or empty history', () => {
    expect(ownerHistoryContainsKey(multiKeyHistory, OTHER)).toBe(false);
    expect(ownerHistoryContainsKey([], KEY_1)).toBe(false);
  });

  it('tolerates entries without an authority', () => {
    const history: OwnerHistoryEntry[] = [{}, { previous_owner_authority: {} }];
    expect(ownerHistoryContainsKey(history, KEY_1)).toBe(false);
  });
});
