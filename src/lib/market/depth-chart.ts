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

export type DepthMarketRefs = {
  highestBid: number;
  lowestAsk: number;
};

/** Legacy `getMinMax` viewport around best bid / best ask (not book extremes). */
export function getDepthViewport({ highestBid, lowestAsk }: DepthMarketRefs): {
  min: number;
  max: number;
} {
  const middle = (highestBid + lowestAsk) / 2;
  return {
    min: Math.max(0, Math.min(middle * 0.65, highestBid)),
    max: Math.max(middle * 1.35, lowestAsk),
  };
}

function bestBidFromBook(bids: MarketOrderRow[]): number {
  if (!bids.length) return 0;
  return Math.max(...bids.map((o) => o.price));
}

function bestAskFromBook(asks: MarketOrderRow[]): number {
  if (!asks.length) return 1;
  return Math.min(...asks.map((o) => o.price));
}

/** Drop dust / joke orders far from the tradeable spread. */
export function filterOrdersForDepthViewport(
  orders: MarketOrderRow[],
  viewport: { min: number; max: number }
): MarketOrderRow[] {
  return orders.filter((o) => o.price >= viewport.min && o.price <= viewport.max);
}

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

/** Cumulative bid/ask series with chart anchors at viewport edges (not `last.price * 4`). */
export function buildDepthSeries(
  bidsArray: MarketOrderRow[],
  asksArray: MarketOrderRow[],
  viewport: { min: number; max: number }
): { bids: DepthSeriesPoint[]; asks: DepthSeriesPoint[] } {
  let bids = aggregateOrders(bidsArray);
  if (bids.length > 0) {
    bids = [{ price: 0, cumulativeSbd: bids[0]!.cumulativeSbd }, ...bids];
  }

  let asks = aggregateOrders(asksArray);
  if (asks.length > 0) {
    const last = asks[asks.length - 1]!;
    asks = [...asks, { price: viewport.max, cumulativeSbd: last.cumulativeSbd }];
  }

  return { bids, asks };
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
  asksArray: MarketOrderRow[],
  refs?: DepthMarketRefs
): DepthChartModel | null {
  if (!bidsArray.length && !asksArray.length) return null;

  const market: DepthMarketRefs = {
    highestBid: refs?.highestBid ?? bestBidFromBook(bidsArray),
    lowestAsk: refs?.lowestAsk ?? bestAskFromBook(asksArray),
  };
  const domain = getDepthViewport(market);

  const filteredBids = filterOrdersForDepthViewport(bidsArray, domain);
  const filteredAsks = filterOrdersForDepthViewport(asksArray, domain);

  if (!filteredBids.length && !filteredAsks.length) return null;

  const { bids, asks } = buildDepthSeries(filteredBids, filteredAsks, domain);
  const chartData = mergeDepthChartData(bids, asks).filter(
    (p) => p.price >= domain.min && p.price <= domain.max
  );

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
