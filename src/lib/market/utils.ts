import type { MarketOrderRow } from './types';

export function roundUp(num: number, precision: number): number {
  let satoshis = num * 10 ** precision;
  satoshis -= 0.0001;
  return Math.ceil(satoshis) / 10 ** precision;
}

export function roundDown(num: number, precision: number): number {
  let satoshis = num * 10 ** precision;
  satoshis += 0.0001;
  return Math.floor(satoshis) / 10 ** precision;
}

/** Merge order book rows that share the same display price. */
export function aggregateOrderBookRows(orders: MarketOrderRow[]): MarketOrderRow[] {
  const out: MarketOrderRow[] = [];
  for (const order of orders) {
    const last = out[out.length - 1];
    if (last && last.stringPrice === order.stringPrice) {
      out[out.length - 1] = {
        ...last,
        steem: last.steem + order.steem,
        sbd: last.sbd + order.sbd,
      };
    } else {
      out.push({ ...order });
    }
  }
  return out;
}

export function marketSpreadPercent(ticker: {
  lowest_ask: number;
  highest_bid: number;
}): number | null {
  const { lowest_ask, highest_bid } = ticker;
  if (highest_bid <= 0) return null;
  return (200 * (lowest_ask - highest_bid)) / (highest_bid + lowest_ask);
}

export function formatAssetAmount(value: number, symbol: string): string {
  return `${value.toFixed(3)} ${symbol}`;
}

export function percentDiff(marketPrice: number, userPrice: number): number {
  if (!marketPrice) return 0;
  return (100 * (userPrice - marketPrice)) / marketPrice;
}
