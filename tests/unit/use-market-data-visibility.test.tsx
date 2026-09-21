/**
 * useMarketData polling visibility (G-9): the 3s market poll ran regardless
 * of document.hidden — background tabs burned 20 req/min each against the
 * 120/min/IP market route limit, so a couple of idle tabs could self-exhaust
 * the quota. The poll must pause while hidden and refresh immediately on
 * return (staleness catch-up), following the use-service-health pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarketData } from '@/hooks/use-market-data';

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getMarketData: vi.fn(),
  },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetMarketData = apiClient.getMarketData as unknown as ReturnType<typeof vi.fn>;

const okSnapshot = {
  success: true,
  orderbook: { bids: [], asks: [] },
  ticker: {
    latest: 1,
    lowest_ask: 1,
    highest_bid: 1,
    percent_change: 0,
    steem_volume: 0,
    sbd_volume: 0,
  },
  trades: [],
  openOrders: [],
};

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useMarketData — polling pauses on hidden page (G-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMarketData.mockResolvedValue(okSnapshot);
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses polling while hidden and refreshes immediately on return', async () => {
    renderHook(() => useMarketData('alice'));

    // Mount refresh.
    await act(async () => {});
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);

    // Visible: the 3s interval keeps polling (2 ticks in 6s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mockGetMarketData).toHaveBeenCalledTimes(3);

    // Hidden: the interval is cleared — no requests for 30s.
    act(() => setVisibility('hidden'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetMarketData).toHaveBeenCalledTimes(3);

    // Visible again: immediate catch-up refresh, then the interval resumes.
    act(() => setVisibility('visible'));
    await act(async () => {});
    expect(mockGetMarketData).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetMarketData).toHaveBeenCalledTimes(5);
  });

  it('does not stack a second interval after repeated hide/show cycles', async () => {
    renderHook(() => useMarketData('alice'));

    await act(async () => {});
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      act(() => setVisibility('hidden'));
      act(() => setVisibility('visible'));
      await act(async () => {});
    }
    // 3 catch-up refreshes, still only one cadence afterwards.
    expect(mockGetMarketData).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    // Exactly 2 interval ticks — a stacked interval would have produced more.
    expect(mockGetMarketData).toHaveBeenCalledTimes(6);
  });

  it('stops polling after unmount even while visible', async () => {
    const { unmount } = renderHook(() => useMarketData('alice'));

    await act(async () => {});
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGetMarketData).toHaveBeenCalledTimes(1);
  });
});
