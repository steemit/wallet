import { describe, expect, it } from 'vitest';
import {
  parseOpenOrder,
  parseOrderBook,
  parseTicker,
  parseTradeFill,
} from '@/lib/market/parse';
import { MARKET_AMOUNT_PRECISION } from '@/lib/market/constants';

describe('market parse', () => {
  it('parses order book bids and asks', () => {
    const { bids, asks } = parseOrderBook({
      bids: [{ real_price: '0.500000', steem: 1000, sbd: 500 }],
      asks: [{ real_price: '0.510000', steem: 2000, sbd: 1020 }],
    });
    expect(bids).toHaveLength(1);
    expect(asks).toHaveLength(1);
    expect(bids[0]?.side).toBe('bids');
    expect(asks[0]?.side).toBe('asks');
    expect(bids[0]?.steem).toBe(1000 / MARKET_AMOUNT_PRECISION);
  });

  it('parses ticker fields', () => {
    const ticker = parseTicker({
      latest: '1.5',
      lowest_ask: '1.6',
      highest_bid: '1.4',
      percent_change: '2.5',
      steem_volume: '100',
      sbd_volume: '150',
    });
    expect(ticker.latest).toBe(1.5);
    expect(ticker.sbd_volume).toBe(150);
  });

  it('parses string-format trade fills', () => {
    const trade = parseTradeFill({
      date: '2024-01-01T12:00:00',
      current_pays: '1.000 SBD',
      open_pays: '2.000 STEEM',
    });
    expect(trade?.type).toBe('bid');
    expect(trade?.steem).toBe(2);
    expect(trade?.sbd).toBe(1);
  });

  it('parses NAI-format trade fills', () => {
    const bid = parseTradeFill({
      date: '2024-01-01T12:00:00Z',
      current_pays: { amount: '1000', precision: 3, nai: '@@000000013' },
      open_pays: { amount: '2000', precision: 3, nai: '@@000000021' },
    });
    expect(bid?.type).toBe('bid');
    expect(bid?.steem).toBe(2);
    expect(bid?.sbd).toBe(1);

    const ask = parseTradeFill({
      date: '2024-01-01T12:00:00Z',
      current_pays: { amount: '2000', precision: 3, nai: '@@000000021' },
      open_pays: { amount: '1000', precision: 3, nai: '@@000000013' },
    });
    expect(ask?.type).toBe('ask');
    expect(ask?.steem).toBe(2);
    expect(ask?.sbd).toBe(1);
  });

  it('parses string-format ask trade fills', () => {
    const trade = parseTradeFill({
      date: '2024-01-01T12:00:00',
      current_pays: '2.000 STEEM',
      open_pays: '1.000 SBD',
    });
    expect(trade?.type).toBe('ask');
    expect(trade?.steem).toBe(2);
    expect(trade?.sbd).toBe(1);
  });

  it('returns null for invalid trade fills', () => {
    expect(parseTradeFill({})).toBeNull();
    expect(
      parseTradeFill({
        date: '2024-01-01T12:00:00',
        current_pays: '0.000 STEEM',
        open_pays: '0.000 STEEM',
      })
    ).toBeNull();
    expect(
      parseTradeFill({
        date: '2024-01-01T12:00:00',
        current_pays: { amount: '1000', precision: 3, nai: '@@unknown' },
        open_pays: { amount: '2000', precision: 3, nai: '@@000000021' },
      })
    ).toBeNull();
  });

  it('parses asset strings only when symbol matches', () => {
    const trade = parseTradeFill({
      date: '2024-01-01T12:00:00',
      current_pays: '1.000 WRONG',
      open_pays: '2.000 STEEM',
    });
    expect(trade).toBeNull();
  });

  it('parses open orders for bids and asks', () => {
    const bid = parseOpenOrder({
      orderid: 1,
      created: '2024-01-01T00:00:00',
      sell_price: { base: '10.000 SBD', quote: '5.000 STEEM' },
      for_sale: 10_000,
    });
    expect(bid.type).toBe('bid');

    const ask = parseOpenOrder({
      orderid: 2,
      created: '2024-01-01T00:00:00',
      sell_price: { base: '5.000 STEEM', quote: '10.000 SBD' },
      for_sale: 5_000,
    });
    expect(ask.type).toBe('ask');
    expect(ask.steem).toBe(5);
  });

  it('handles open orders with zero steem', () => {
    const order = parseOpenOrder({
      orderid: 3,
      created: '2024-01-01T00:00:00',
      sell_price: { base: '0.000 STEEM', quote: '0.000 SBD' },
      for_sale: 0,
    });
    expect(order.price).toBe(0);
  });
});
