/**
 * Race-guard tests for the data-fetch hooks that lacked them (finding G-6):
 * use-market-data and use-proposals. A response started for a previous
 * username/filter must never overwrite the current snapshot — the market
 * case could render the PREVIOUS user's open orders in the new user's view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMarketData } from '@/hooks/use-market-data';
import type { MarketOpenOrderRow } from '@/lib/market/types';

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getMarketData: vi.fn(),
  },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetMarketData = apiClient.getMarketData as unknown as ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function marketSnapshot(username: string, orderId: number) {
  const order: MarketOpenOrderRow = {
    orderid: orderId,
    created: '2026-01-01T00:00:00',
    type: 'bid',
    steem: 1,
    sbd: 1,
    price: 1,
  };
  return {
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
    openOrders: [{ ...order, orderid: orderId, created: username }],
  };
}

describe('useMarketData — race guard on username switch (G-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the previous username’s in-flight response; snapshot holds only the new user’s orders', async () => {
    const alice = deferred<ReturnType<typeof marketSnapshot>>();
    const bob = deferred<ReturnType<typeof marketSnapshot>>();
    mockGetMarketData
      .mockImplementationOnce(() => alice.promise)
      .mockImplementationOnce(() => bob.promise);

    const { result, rerender } = renderHook(({ u }) => useMarketData(u), {
      initialProps: { u: 'alice' as string | null },
    });

    // Switch username while alice's request is still in flight.
    rerender({ u: 'bob' });

    await act(async () => {
      bob.resolve(marketSnapshot('bob', 2));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // alice's response lands AFTER bob's — it must be dropped entirely.
    await act(async () => {
      alice.resolve(marketSnapshot('alice', 1));
    });

    expect(result.current.openOrders).toHaveLength(1);
    expect((result.current.openOrders[0] as MarketOpenOrderRow).created).toBe('bob');
    expect((result.current.openOrders[0] as MarketOpenOrderRow).orderid).toBe(2);
  });

  it('a superseded poll response does not overwrite a newer snapshot', async () => {
    const first = deferred<ReturnType<typeof marketSnapshot>>();
    const second = deferred<ReturnType<typeof marketSnapshot>>();
    mockGetMarketData
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useMarketData('alice'));

    // A newer refresh starts before the older one resolves.
    await act(async () => {
      void result.current.refresh();
    });

    await act(async () => {
      second.resolve(marketSnapshot('alice', 2));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      first.resolve(marketSnapshot('alice', 1));
    });

    expect((result.current.openOrders[0] as MarketOpenOrderRow).orderid).toBe(2);
  });
});
