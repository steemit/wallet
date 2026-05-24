import { describe, it, expect } from 'vitest';
import {
  normalizeSteemHistoryEntry,
  normalizeSteemHistoryList,
} from '@/lib/wallet/normalize-history';

describe('normalizeSteemHistoryEntry', () => {
  it('returns null for null input', () => {
    expect(normalizeSteemHistoryEntry(null)).toBeNull();
    expect(normalizeSteemHistoryEntry('string')).toBeNull();
  });

  it('normalizes tuple format and preserves index', () => {
    const result = normalizeSteemHistoryEntry([
      42,
      {
        op: ['transfer', { from: 'alice', to: 'bob', amount: '1.000 STEEM', memo: '' }],
        timestamp: '2026-01-01T00:00:00',
        block: 99999,
        trx_id: 'abc123',
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(42);
    expect(result!.op[0]).toBe('transfer');
    expect(result!.block).toBe(99999);
  });

  it('normalizes flat format (already-expanded object)', () => {
    const flat = {
      op: ['author_reward', { author: 'alice', permlink: 'p', reward: '100 VESTS' }] as [string, Record<string, unknown>],
      timestamp: '2026-01-01T00:00:00',
      block: 12345,
      trx_id: 'def456',
      index: 7,
    };
    const result = normalizeSteemHistoryEntry(flat);
    expect(result).not.toBeNull();
    expect(result!.op[0]).toBe('author_reward');
    expect(result!.index).toBe(7);
  });

  it('returns null for flat format with no timestamp', () => {
    const noTimestamp = {
      op: ['transfer', {}] as [string, Record<string, unknown>],
      timestamp: '',
      block: 1,
      trx_id: 'x',
    };
    expect(normalizeSteemHistoryEntry(noTimestamp)).toBeNull();
  });

  it('returns null for tuple with missing entry', () => {
    expect(normalizeSteemHistoryEntry([42, null])).toBeNull();
  });
});

describe('normalizeSteemHistoryList', () => {
  it('skips null entries and returns only valid items', () => {
    const items = [
      [1, { op: ['transfer', {}], timestamp: '2026-01-01T00:00:00', block: 1, trx_id: 'a' }],
      null,
      'garbage',
      [2, { op: ['vote', {}], timestamp: '2026-01-02T00:00:00', block: 2, trx_id: 'b' }],
    ];
    const result = normalizeSteemHistoryList(items);
    expect(result).toHaveLength(2);
    expect(result[0]!.index).toBe(1);
    expect(result[1]!.index).toBe(2);
  });
});
