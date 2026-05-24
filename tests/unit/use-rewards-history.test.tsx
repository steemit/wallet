/**
 * useRewardsHistory — tests the client hook's interaction with the server-filtered API.
 *
 * The API now returns already-normalized SteemHistoryItem[] with `nextFrom` and
 * `exhausted` fields. Client-side filtering is gone; the hook just accumulates
 * what the server returns and tracks the pagination cursor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRewardsHistory } from '@/lib/wallet/use-rewards-history';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

vi.mock('@/lib/steem/client', () => ({
  apiClient: { getHistory: vi.fn() },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetHistory = apiClient.getHistory as unknown as ReturnType<typeof vi.fn>;

function makeItems(
  count: number,
  opType: string,
  startIndex: number = 1000
): SteemHistoryItem[] {
  return Array.from({ length: count }, (_, i) => ({
    op: [opType, { reward: '1.000000 VESTS' }] as [string, Record<string, unknown>],
    timestamp: '2026-05-01T10:00:00',
    block: startIndex + i,
    trx_id: `trx-${startIndex + i}`,
    index: startIndex + i,
  }));
}

function serverPage(
  items: SteemHistoryItem[],
  nextFrom: number | null,
  exhausted: boolean
) {
  return { history: items, nextFrom, exhausted };
}

describe('useRewardsHistory', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
  });

  it('does not fetch until enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useRewardsHistory('alice', 'curation_reward', enabled),
      { initialProps: { enabled: false } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).not.toHaveBeenCalled();

    rerender({ enabled: true });
    mockGetHistory.mockResolvedValue(serverPage([], null, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalled();
  });

  it('passes ops param to apiClient', async () => {
    mockGetHistory.mockResolvedValue(serverPage([], null, true));
    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const firstCall = mockGetHistory.mock.calls[0] as [string, number, number | undefined, string[]];
    expect(firstCall[3]).toEqual(['curation_reward']);
  });

  it('stops auto-fetching as soon as 10 matches are accumulated', async () => {
    // Server returns 10 matches immediately — loop must stop after first call.
    mockGetHistory.mockResolvedValue(
      serverPage(makeItems(10, 'curation_reward', 990), 989, false)
    );

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
    expect(result.current.history).toHaveLength(10);
    expect(result.current.exhausted).toBe(false);
  });

  it('pulls up to 5 batches when server returns 0 matches per batch', async () => {
    // Server finds no matches each time but reports more history available.
    mockGetHistory
      .mockResolvedValueOnce(serverPage([], 899, false))
      .mockResolvedValueOnce(serverPage([], 799, false))
      .mockResolvedValueOnce(serverPage([], 699, false))
      .mockResolvedValueOnce(serverPage([], 599, false))
      .mockResolvedValueOnce(serverPage([], 499, false));

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalledTimes(5);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.exhausted).toBe(false);
  });

  it('marks exhausted when server reports exhausted', async () => {
    mockGetHistory.mockResolvedValue(serverPage([], null, true));

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exhausted).toBe(true);
    expect(result.current.history).toHaveLength(0);
  });

  it('marks exhausted when server returns nextFrom: null', async () => {
    mockGetHistory.mockResolvedValue(serverPage(makeItems(3, 'curation_reward', 0), null, false));

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exhausted).toBe(true);
    expect(result.current.history).toHaveLength(3);
  });

  it('surfaces fetch errors instead of swallowing them', async () => {
    mockGetHistory.mockResolvedValue({ history: [], error: 'Request Timeout' });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Request Timeout');
    expect(result.current.history).toHaveLength(0);
    expect(result.current.exhausted).toBe(false);
  });

  it('loadMore retries from latest after an initial failure', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ history: [], error: 'Request Timeout' })
      .mockResolvedValueOnce(serverPage(makeItems(5, 'curation_reward', 900), 899, false));

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Request Timeout');

    await act(async () => {
      await result.current.loadMore();
    });

    // Retry must use from=undefined (nextCursor is null after error).
    const calls = mockGetHistory.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, number, number | undefined, string[]];
    expect(lastCall[0]).toBe('alice');
    expect(lastCall[2]).toBeUndefined();
    expect(lastCall[3]).toEqual(['curation_reward']);
    expect(result.current.error).toBeNull();
  });

  it('loadMore pages older using server-provided nextFrom', async () => {
    // Initial 5 auto-batches return empty results; last nextFrom = 499.
    mockGetHistory
      .mockResolvedValueOnce(serverPage([], 899, false))
      .mockResolvedValueOnce(serverPage([], 799, false))
      .mockResolvedValueOnce(serverPage([], 699, false))
      .mockResolvedValueOnce(serverPage([], 599, false))
      .mockResolvedValueOnce(serverPage([], 499, false))
      // loadMore call
      .mockResolvedValueOnce(serverPage(makeItems(5, 'curation_reward', 400), 399, false));

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalledTimes(5);

    await act(async () => {
      await result.current.loadMore();
    });

    const calls = mockGetHistory.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, number, number | undefined, string[]];
    // loadMore must pass the nextFrom from the last auto-batch (499).
    expect(lastCall[2]).toBe(499);
    expect(lastCall[3]).toEqual(['curation_reward']);
    expect(result.current.history).toHaveLength(5);
    expect(result.current.exhausted).toBe(false);
  });
});
