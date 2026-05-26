import type { MarketOrderRow } from './types';

import { MARKET_AMOUNT_PRECISION } from './constants';

export type DepthSeriesPoint = {
  price: number;
  cumulativeSbd: number;
};

export type DepthChartModel = {
  bids: DepthSeriesPoint[];
  asks: DepthSeriesPoint[];
  /** Merged rows for a single Recharts `data` array. */
  chartData: DepthChartPoint[];
  domain: { min: number; max: number };
};

export type DepthChartPoint = {
  price: number;
  bidDepth: number | null;
  askDepth: number | null;
};

/** Legacy depth chart cumulates raw API integers; we store human SBD on rows. */
function aggregateOrders(orders: MarketOrderRow[]): DepthSeriesPoint[] {
  let ttl = 0;
  return orders
    .map((o) => {
      ttl += o.sbd * MARKET_AMOUNT_PRECISION;
      return { price: o.price, cumulativeSbd: ttl };
    })
    .sort((a, b) => a.price - b.price);
}

/** Port of legacy `generateBidAsk` + padding anchors. */
export function buildDepthSeries(
  bidsArray: MarketOrderRow[],
  asksArray: MarketOrderRow[]
): { bids: DepthSeriesPoint[]; asks: DepthSeriesPoint[] } {
  let bids = aggregateOrders(bidsArray);
  if (bids.length > 0) {
    bids = [{ price: 0, cumulativeSbd: bids[0]!.cumulativeSbd }, ...bids];
  }

  let asks = aggregateOrders(asksArray);
  if (asks.length > 0) {
    const last = asks[asks.length - 1]!;
    asks = [...asks, { price: last.price * 4, cumulativeSbd: last.cumulativeSbd }];
  }

  return { bids, asks };
}

/** Port of legacy `getMinMax` (prices, not scaled integers). */
export function getDepthPriceDomain(
  bids: DepthSeriesPoint[],
  asks: DepthSeriesPoint[]
): { min: number; max: number } {
  const highestBid = bids.length ? bids[bids.length - 1]!.price : 0;
  const lowestAsk = asks.length ? asks[0]!.price : 1;
  const middle = (highestBid + lowestAsk) / 2;

  // Legacy centers the chart, but when the spread is very wide the computed `min`
  // can end up to the right of the highest bid, making the bid series invisible.
  // Clamp so the viewport always contains both sides.
  return {
    min: Math.max(bids[0]?.price ?? 0, Math.min(middle * 0.65, highestBid)),
    max: Math.min(
      asks[asks.length - 1]?.price ?? middle * 1.35,
      Math.max(middle * 1.35, lowestAsk)
    ),
  };
}

export function mergeDepthChartData(
  bids: DepthSeriesPoint[],
  asks: DepthSeriesPoint[]
): DepthChartPoint[] {
  const byPrice = new Map<number, DepthChartPoint>();

  for (const p of bids) {
    const row = byPrice.get(p.price) ?? { price: p.price, bidDepth: null, askDepth: null };
    row.bidDepth = p.cumulativeSbd;
    byPrice.set(p.price, row);
  }
  for (const p of asks) {
    const row = byPrice.get(p.price) ?? { price: p.price, bidDepth: null, askDepth: null };
    row.askDepth = p.cumulativeSbd;
    byPrice.set(p.price, row);
  }

  return [...byPrice.values()].sort((a, b) => a.price - b.price);
}

export function buildDepthChartModel(
  bidsArray: MarketOrderRow[],
  asksArray: MarketOrderRow[]
): DepthChartModel | null {
  if (!bidsArray.length && !asksArray.length) return null;

  const { bids, asks } = buildDepthSeries(bidsArray, asksArray);
  const domain = getDepthPriceDomain(bids, asks);
  const chartData = mergeDepthChartData(bids, asks);

  return { bids, asks, chartData, domain };
}

/** Y-axis labels aligned with legacy DepthChart (`value` is cumulative millisbd). */
export function formatDepthYAxisLabel(value: number): string {
  const sbd = value / MARKET_AMOUNT_PRECISION;
  if (sbd > 1e6) return `$${(sbd / 1e6).toFixed(3)}M`;
  if (sbd > 10000) return `$${(sbd / 1e3).toFixed(0)}k`;
  return `$${sbd}`;
}

export function formatDepthTooltipSbd(value: number): string {
  return `$${(value / MARKET_AMOUNT_PRECISION).toFixed(3)}`;
}
