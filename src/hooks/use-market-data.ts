'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { aggregateOrderBookRows, dedupeTradeHistory, marketTradeRowKey } from '@/lib/market/utils';
import { MARKET_POLL_INTERVAL_MS } from '@/lib/market/constants';
import type {
  MarketOpenOrderRow,
  MarketOrderRow,
  MarketTicker,
  MarketTradeRow,
} from '@/lib/market/types';

type MarketSnapshot = {
  orderbook: { bids: MarketOrderRow[]; asks: MarketOrderRow[] };
  ticker: MarketTicker | null;
  history: MarketTradeRow[];
  openOrders: MarketOpenOrderRow[];
  loading: boolean;
  error: string | null;
};

const emptySnapshot = (): MarketSnapshot => ({
  orderbook: { bids: [], asks: [] },
  ticker: null,
  history: [],
  openOrders: [],
  loading: true,
  error: null,
});

function parseTradeFromApi(t: {
  date: string;
  type: string;
  steem: number;
  sbd: number;
  price: number;
  stringPrice: string;
}): MarketTradeRow {
  return {
    date: new Date(t.date),
    type: t.type === 'ask' ? 'ask' : 'bid',
    steem: t.steem,
    sbd: t.sbd,
    price: t.price,
    stringPrice: t.stringPrice,
  };
}

export function useMarketData(username: string | null) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>(emptySnapshot);
  const lastTradeRef = useRef<Date | null>(null);
  const historyInitializedRef = useRef(false);
  // Race guard (docs/AI-driver/06 rule 1): responses of a request started
  // for a PREVIOUS username (or superseded by a newer poll) must never write
  // the snapshot — otherwise the previous user's openOrders/orders land in
  // the new user's view.
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    // Latest request wins: each refresh supersedes any still in flight.
    const requestId = ++requestIdRef.current;
    try {
      const since =
        historyInitializedRef.current && lastTradeRef.current
          ? lastTradeRef.current.toISOString().slice(0, -5)
          : undefined;

      const data = await apiClient.getMarketData({
        ...(username ? { username } : {}),
        ...(since ? { since } : {}),
      });

      if (requestId !== requestIdRef.current) return;

      if (!data.success || !data.orderbook || !data.ticker) {
        setSnapshot((prev) => ({
          ...prev,
          loading: false,
          error: data.error ?? 'Failed to load market',
        }));
        return;
      }

      const bids = aggregateOrderBookRows(data.orderbook.bids as MarketOrderRow[]);
      const asks = aggregateOrderBookRows(data.orderbook.asks as MarketOrderRow[]);
      const ticker = data.ticker as MarketTicker;
      const incoming = (data.trades ?? []).map(parseTradeFromApi);

      setSnapshot((prev) => {
        let history = prev.history;
        if (!historyInitializedRef.current) {
          history = dedupeTradeHistory(incoming);
          historyInitializedRef.current = true;
        } else if (incoming.length > 0) {
          const seen = new Set(history.map(marketTradeRowKey));
          const novel = incoming.filter((t) => !seen.has(marketTradeRowKey(t)));
          history = dedupeTradeHistory([...novel, ...history]);
        }

        return {
          orderbook: { bids, asks },
          ticker,
          history,
          openOrders: (data.openOrders ?? []) as MarketOpenOrderRow[],
          loading: false,
          error: null,
        };
      });

      const newest = incoming[0];
      if (newest) {
        lastTradeRef.current = new Date(newest.date.getTime() + 1000);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load market',
      }));
    }
  }, [username]);

  useEffect(() => {
    // Invalidate any in-flight request for the previous user.
    requestIdRef.current += 1;
    historyInitializedRef.current = false;
    lastTradeRef.current = null;
    setSnapshot(emptySnapshot());
  }, [username]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cancelled) await refresh();
    };
    void run();
    const id = setInterval(() => {
      if (!cancelled) void refresh();
    }, MARKET_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refresh]);

  return { ...snapshot, refresh };
}
