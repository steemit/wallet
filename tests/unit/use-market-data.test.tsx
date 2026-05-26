import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMarketData } from '@/hooks/use-market-data';

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getMarketData: vi.fn(),
  },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetMarketData = apiClient.getMarketData as unknown as ReturnType<typeof vi.fn>;

describe('useMarketData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads market snapshot for a user', async () => {
    mockGetMarketData.mockResolvedValue({
      success: true,
      orderbook: {
        bids: [{ side: 'bids', price: 1, stringPrice: '1.000000', steem: 1, sbd: 1 }],
        asks: [],
      },
      ticker: {
        latest: 1,
        lowest_ask: 1.1,
        highest_bid: 0.9,
        percent_change: 0,
        steem_volume: 0,
        sbd_volume: 0,
      },
      trades: [
        {
          date: '2024-01-01T12:00:00.000Z',
          type: 'bid',
          steem: 1,
          sbd: 1,
          price: 1,
          stringPrice: '1.000000',
        },
      ],
      openOrders: [],
    });

    const { result } = renderHook(() => useMarketData('alice'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetMarketData).toHaveBeenCalled();
    expect(result.current.ticker?.latest).toBe(1);
    expect(result.current.history).toHaveLength(1);
  });

  it('surfaces API errors', async () => {
    mockGetMarketData.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useMarketData(null));

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
  });

  it('handles network failures', async () => {
    mockGetMarketData.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useMarketData(null));

    await waitFor(() => {
      expect(result.current.error).toBe('network');
    });
  });

  it('dedupes overlapping poll trade history', async () => {
    const trade = {
      date: '2024-01-01T12:00:00.000Z',
      type: 'bid',
      steem: 1.039,
      sbd: 0.113,
      price: 0.10972,
      stringPrice: '0.109720',
    };
    mockGetMarketData
      .mockResolvedValueOnce({
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
        trades: [trade],
        openOrders: [],
      })
      .mockResolvedValueOnce({
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
        trades: [trade, trade],
        openOrders: [],
      });

    const { result } = renderHook(() => useMarketData(null));

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    });

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    });
  });
});
