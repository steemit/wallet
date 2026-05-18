import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRewardsHistoryPager } from '@/lib/wallet/use-rewards-history-pager';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

function makeItems(count: number): SteemHistoryItem[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    timestamp: '2026-05-18T10:00:00',
    trx_id: `trx-${i}`,
    op: ['transfer', { amount: '1 STEEM', from: 'a', to: 'b' }] as SteemHistoryItem['op'],
  }));
}

function baseState(overrides: Partial<Parameters<typeof useRewardsHistoryPager>[0]> = {}) {
  return {
    history: makeItems(25),
    loading: false,
    loadingMore: false,
    exhausted: false,
    error: null,
    loadMore: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useRewardsHistoryPager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pages locally with Older before fetching from chain', async () => {
    const state = baseState();
    const { result } = renderHook(() => useRewardsHistoryPager(state, 'alice'));

    expect(result.current.page).toHaveLength(10);
    expect(result.current.canGoOlder).toBe(true);

    await act(async () => {
      await result.current.onOlder();
    });

    expect(state.loadMore).not.toHaveBeenCalled();
    expect(result.current.page).toHaveLength(10);
  });

  it('calls loadMore when Older is pressed at the end of loaded data', async () => {
    const state = baseState({ history: makeItems(12) });
    const { result } = renderHook(() => useRewardsHistoryPager(state, 'alice'));

    await act(async () => {
      await result.current.onOlder();
    });
    expect(state.loadMore).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onOlder();
    });

    expect(state.loadMore).toHaveBeenCalledTimes(1);
  });

  it('disables Older when exhausted and no local older pages', () => {
    const state = baseState({ history: makeItems(5), exhausted: true });
    const { result } = renderHook(() => useRewardsHistoryPager(state, 'alice'));

    expect(result.current.canGoOlder).toBe(false);
  });

  it('keeps Older enabled after error for retry', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const state = baseState({
      history: makeItems(5),
      exhausted: true,
      error: 'timeout',
      loadMore,
    });
    const { result } = renderHook(() => useRewardsHistoryPager(state, 'alice'));

    expect(result.current.canGoOlder).toBe(true);

    await act(async () => {
      await result.current.onOlder();
    });

    expect(loadMore).toHaveBeenCalled();
  });

  it('resets page index when resetKey changes', async () => {
    const state = baseState({ history: makeItems(25) });
    const { result, rerender } = renderHook(
      ({ key }) => useRewardsHistoryPager(state, key),
      { initialProps: { key: 'a' } }
    );

    await act(async () => {
      await result.current.onOlder();
    });
    expect(result.current.canGoNewer).toBe(true);

    rerender({ key: 'b' });
    await waitFor(() => expect(result.current.canGoNewer).toBe(false));
  });
});
