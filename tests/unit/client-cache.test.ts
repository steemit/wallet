import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clientCache } from '@/lib/cache/client-cache';

describe('ClientCache', () => {
  beforeEach(() => {
    clientCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves data', () => {
    clientCache.set('key1', { value: 42 }, 10_000, 30_000);
    const result = clientCache.get<{ value: number }>('key1');
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ value: 42 });
    expect(result!.stale).toBe(false);
  });

  it('returns null for missing keys', () => {
    expect(clientCache.get('missing')).toBeNull();
  });

  it('marks data as stale after staleMs', () => {
    clientCache.set('key1', 'data', 5_000, 20_000);

    vi.advanceTimersByTime(6_000);

    const result = clientCache.get<string>('key1');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.data).toBe('data');
  });

  it('returns null after maxAgeMs', () => {
    clientCache.set('key1', 'data', 5_000, 10_000);

    vi.advanceTimersByTime(11_000);

    expect(clientCache.get('key1')).toBeNull();
  });

  it('overwrites existing keys', () => {
    clientCache.set('key1', 'first', 5_000, 20_000);
    clientCache.set('key1', 'second', 5_000, 20_000);

    const result = clientCache.get<string>('key1');
    expect(result!.data).toBe('second');
  });

  it('evicts oldest entries at max capacity', () => {
    // Fill to capacity (50)
    for (let i = 0; i < 50; i++) {
      clientCache.set(`key-${i}`, `value-${i}`, 60_000, 120_000);
    }

    // Add one more — should evict key-0
    clientCache.set('key-50', 'value-50', 60_000, 120_000);

    expect(clientCache.get('key-0')).toBeNull();
    expect(clientCache.get('key-50')).not.toBeNull();
    expect(clientCache.get('key-1')).not.toBeNull();
  });

  it('invalidates entries by prefix substring match', () => {
    clientCache.set('user:alice:balance', 100, 60_000, 120_000);
    clientCache.set('user:alice:history', [], 60_000, 120_000);
    clientCache.set('user:bob:balance', 200, 60_000, 120_000);

    clientCache.invalidate('alice');

    expect(clientCache.get('user:alice:balance')).toBeNull();
    expect(clientCache.get('user:alice:history')).toBeNull();
    expect(clientCache.get('user:bob:balance')).not.toBeNull();
  });

  it('clear() removes all entries', () => {
    clientCache.set('a', 1, 60_000, 120_000);
    clientCache.set('b', 2, 60_000, 120_000);

    clientCache.clear();

    expect(clientCache.get('a')).toBeNull();
    expect(clientCache.get('b')).toBeNull();
  });
});
