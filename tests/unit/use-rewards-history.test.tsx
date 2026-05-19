import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRewardsHistory } from '@/lib/wallet/use-rewards-history';

vi.mock('@/lib/steem/client', () => ({
  apiClient: { getHistory: vi.fn() },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetHistory = apiClient.getHistory as unknown as ReturnType<typeof vi.fn>;

function tupleOp(index: number, opType: string, timestamp: string, payload: Record<string, unknown> = {}) {
  return [
    index,
    {
      block: 1,
      op: [opType, payload],
      op_in_trx: 0,
      timestamp,
      trx_id: `trx-${index}`,
      trx_in_block: 0,
      virtual_op: 0,
    },
  ];
}

function makeBatch(startIndex: number, count: number, opType: string = 'transfer') {
  // Returns ascending tuples: indices [startIndex, startIndex+count-1]
  return Array.from({ length: count }, (_, i) =>
    tupleOp(startIndex + i, opType, `2026-05-${String((i % 28) + 1).padStart(2, '0')}T10:00:00`)
  );
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
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalled();
  });

  it('stops auto-fetching as soon as 10 matches are accumulated', async () => {
    // Batch 1 already has 10 curation rewards → loop must stop after first batch.
    const items = Array.from({ length: 100 }, (_, i) =>
      tupleOp(1000 + i, i < 10 ? 'curation_reward' : 'transfer', `2026-05-18T10:00:00`, {
        reward: '1.000000 VESTS',
      })
    );
    mockGetHistory.mockResolvedValue({ history: items });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
    expect(result.current.history).toHaveLength(10);
    expect(result.current.exhausted).toBe(false);
    expect(result.current.totalFetched).toBe(100);
  });

  it('pulls up to 5 batches and stops when none match', async () => {
    // Five batches with no curation rewards; oldestIn keeps decreasing but stays >0.
    let batch = 0;
    mockGetHistory.mockImplementation(() => {
      batch += 1;
      const start = 1000 - batch * 100; // 900, 800, 700, 600, 500
      return Promise.resolve({ history: makeBatch(start, 100, 'transfer') });
    });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetHistory).toHaveBeenCalledTimes(5);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.totalFetched).toBe(500);
    expect(result.current.exhausted).toBe(false);
  });

  it('marks exhausted when oldest index reaches 0', async () => {
    // Account has < 100 ops: first batch returns 50 records starting at index 0.
    mockGetHistory.mockResolvedValue({ history: makeBatch(0, 50, 'transfer') });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.exhausted).toBe(true);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.totalFetched).toBe(50);
  });

  it('surfaces fetch errors instead of swallowing them', async () => {
    mockGetHistory.mockResolvedValue({ history: [], error: 'Request Timeout' });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Request Timeout');
    expect(result.current.history).toHaveLength(0);
    // exhausted must stay false so the UI can render a retry button.
    expect(result.current.exhausted).toBe(false);
  });

  it('loadMore retries from latest after an initial failure', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ history: [], error: 'Request Timeout' })
      .mockResolvedValueOnce({ history: makeBatch(900, 100, 'transfer') });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Request Timeout');

    await act(async () => {
      await result.current.loadMore();
    });

    // Retry must use the default latest slice (no `from` param), not a stale anchor.
    const calls = mockGetHistory.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, number, number | undefined];
    expect(lastCall[0]).toBe('alice');
    expect(lastCall[2]).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.totalFetched).toBe(100);
  });

  it('loadMore pages older when oldestIndex is set', async () => {
    mockGetHistory
      .mockResolvedValueOnce({ history: makeBatch(900, 100, 'transfer') })
      // Subsequent auto-fetches keep oldestIn > 0 so isExhausted stays false.
      .mockResolvedValueOnce({ history: makeBatch(800, 100, 'transfer') })
      .mockResolvedValueOnce({ history: makeBatch(700, 100, 'transfer') })
      .mockResolvedValueOnce({ history: makeBatch(600, 100, 'transfer') })
      .mockResolvedValueOnce({ history: makeBatch(500, 100, 'transfer') })
      .mockResolvedValueOnce({ history: makeBatch(400, 100, 'transfer') });

    const { result } = renderHook(() => useRewardsHistory('alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalFetched).toBe(500);

    await act(async () => {
      await result.current.loadMore();
    });

    const calls = mockGetHistory.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, number, number | undefined];
    expect(lastCall[2]).toBe(499); // from = oldestIndex(500) - 1
    expect(result.current.totalFetched).toBe(600);
  });
});
