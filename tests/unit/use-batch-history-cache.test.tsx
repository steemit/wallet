/**
 * useBatchHistory unmount-cache regression tests (review finding G-5).
 *
 * The persistence cleanup used to live in an effect keyed on [cacheKey] and
 * read `history` from its render closure:
 *  - on a normal unmount the closure held the mount-time EMPTY history, so
 *    pagination progress was never persisted at all;
 *  - on an in-place username switch (/@alice/transfers → /@bob/transfers,
 *    same component instance) the re-run effect captured the NEW cacheKey
 *    with the OLD user's history, so leaving the page wrote alice's rows
 *    under `activity:bob` — cross-user data display for up to 120s.
 *
 * These tests pin the three required behaviors: correct unmount persistence,
 * no cross-user cache writes, and cross-mount progress resume.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBatchHistory } from '@/hooks/use-batch-history';
import { clientCache } from '@/lib/cache/client-cache';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getHistory: vi.fn(),
  },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetHistory = apiClient.getHistory as unknown as ReturnType<typeof vi.fn>;

interface CachedData {
  history: SteemHistoryItem[];
  nextCursor: number | null;
  totalFetched: number;
}

function item(id: string, index: number): SteemHistoryItem {
  return {
    index,
    timestamp: '2026-09-01T00:00:00',
    block: index,
    trx_id: id,
    op: ['transfer', { amount: '1.000 STEEM', from: 'a', to: 'b' }] as SteemHistoryItem['op'],
  };
}

/** A batch of `count` items tagged with `prefix` (index descending = older). */
function batch(prefix: string, count: number, startIndex: number): SteemHistoryItem[] {
  return Array.from({ length: count }, (_, i) => item(`${prefix}-${i}`, startIndex + i));
}

describe('useBatchHistory — unmount cache persistence (G-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientCache.clear();
  });

  it('persists loaded history on unmount under the correct cache key', async () => {
    mockGetHistory.mockResolvedValue({
      history: batch('a', 10, 0),
      nextFrom: 44,
      exhausted: false,
    });

    const { result, unmount } = renderHook(() =>
      useBatchHistory({ username: 'alice', cacheKey: 'activity:alice', ops: ['transfer'] })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.history).toHaveLength(10);

    // Nothing is written while the hook is alive — only on leave.
    expect(clientCache.get<CachedData>('activity:alice')).toBeNull();

    unmount();

    const cached = clientCache.get<CachedData>('activity:alice');
    expect(cached).not.toBeNull();
    expect(cached?.data.history).toHaveLength(10);
    expect(cached?.data.history.every((h) => h.trx_id.startsWith('a-'))).toBe(true);
    expect(cached?.data.nextCursor).toBe(44);
  });

  it('never writes the previous user’s history under the new user’s cache key', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ history: batch('alice', 10, 0), nextFrom: 50, exhausted: false })
      .mockResolvedValueOnce({ history: batch('bob', 10, 0), nextFrom: 50, exhausted: false });

    const { result, rerender, unmount } = renderHook(
      ({ u }) => useBatchHistory({ username: u, cacheKey: `activity:${u}`, ops: ['transfer'] }),
      { initialProps: { u: 'alice' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.history.every((h) => h.trx_id.startsWith('alice-'))).toBe(true);

    // In-place username switch: same hook instance, only cacheKey changes.
    rerender({ u: 'bob' });
    await waitFor(() =>
      expect(result.current.history.every((h) => h.trx_id.startsWith('bob-'))).toBe(true)
    );

    unmount();

    const bobCache = clientCache.get<CachedData>('activity:bob');
    expect(bobCache).not.toBeNull();
    expect(bobCache?.data.history).toHaveLength(10);
    // The cross-user pollution assertion: bob's entry must not contain a
    // single alice row.
    expect(bobCache?.data.history.some((h) => h.trx_id.startsWith('alice-'))).toBe(false);

    // alice's own progress is persisted under her own key at switch time.
    const aliceCache = clientCache.get<CachedData>('activity:alice');
    expect(aliceCache).not.toBeNull();
    expect(aliceCache?.data.history.every((h) => h.trx_id.startsWith('alice-'))).toBe(true);
  });

  it('resumes pagination progress on remount without refetching', async () => {
    mockGetHistory.mockImplementation(
      async (_u: string, _limit: number, from?: number) => {
        if (from === undefined) {
          return { history: batch('a', 10, 0), nextFrom: 44, exhausted: false };
        }
        return { history: batch('a', 5, 10), nextFrom: 30, exhausted: false };
      }
    );

    const first = renderHook(() =>
      useBatchHistory({ username: 'alice', cacheKey: 'activity:alice', ops: ['transfer'] })
    );
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    await act(async () => {
      await first.result.current.loadMore();
    });
    expect(first.result.current.history).toHaveLength(15);

    first.unmount();

    const cached = clientCache.get<CachedData>('activity:alice');
    expect(cached?.data.history).toHaveLength(15);
    expect(cached?.data.nextCursor).toBe(30);

    // Remount: history comes back from the L1 cache with no network call.
    mockGetHistory.mockClear();
    const second = renderHook(() =>
      useBatchHistory({ username: 'alice', cacheKey: 'activity:alice', ops: ['transfer'] })
    );

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.history).toHaveLength(15);
    expect(second.result.current.totalFetched).toBe(first.result.current.totalFetched);
    expect(mockGetHistory).not.toHaveBeenCalled();
    expect(second.result.current.exhausted).toBe(false);
  });
});
