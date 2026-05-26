import { describe, expect, it } from 'vitest';
import {
  buildDepthChartModel,
  buildDepthSeries,
  filterOrdersForDepthViewport,
  formatDepthTooltipSbd,
  formatDepthYAxisLabel,
  getDepthViewport,
} from '@/lib/market/depth-chart';
import type { MarketOrderRow } from '@/lib/market/types';

const row = (
  side: MarketOrderRow['side'],
  price: number,
  sbd: number,
  steem: number
): MarketOrderRow => ({
  side,
  price,
  stringPrice: price.toFixed(6),
  sbd,
  steem,
});

describe('depth chart data', () => {
  const refs = { highestBid: 0.109728, lowestAsk: 0.109889 };
  const viewport = getDepthViewport(refs);

  it('builds padded bid/ask series anchored to viewport max', () => {
    const bids = [row('bids', 0.5, 10, 20)];
    const asks = [row('asks', 0.55, 5, 9)];
    const { bids: bidSeries, asks: askSeries } = buildDepthSeries(bids, asks, viewport);

    expect(bidSeries[0]?.price).toBe(0);
    expect(bidSeries[0]?.cumulativeSbd).toBe(bidSeries[1]?.cumulativeSbd);
    expect(askSeries[askSeries.length - 1]?.price).toBe(viewport.max);
  });

  it('computes price domain around best bid and ask', () => {
    expect(viewport.min).toBeLessThan(refs.highestBid);
    expect(viewport.max).toBeGreaterThan(refs.lowestAsk);
    expect(viewport.max).toBeLessThan(1);
  });

  it('filters outlier orders outside the viewport', () => {
    const bids = [
      row('bids', 0.11, 1, 1),
      row('bids', 1_000_000, 0.001, 1),
    ];
    const filtered = filterOrdersForDepthViewport(bids, viewport);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.price).toBeCloseTo(0.11);
  });

  it('keeps both bid and ask visible when book has dust far from spread', () => {
    const model = buildDepthChartModel(
      [row('bids', 0.109728, 10, 90), row('bids', 500_000, 0.001, 1)],
      [row('asks', 0.109889, 8, 70), row('asks', 2_000_000, 0.001, 1)],
      refs
    );

    expect(model?.domain.max).toBeLessThan(1);
    expect(model?.chartData.some((p) => p.bidDepth != null)).toBe(true);
    expect(model?.chartData.some((p) => p.askDepth != null)).toBe(true);
    expect(model?.chartData.every((p) => p.price <= model!.domain.max)).toBe(true);
  });

  it('formats axis and tooltip like legacy', () => {
    expect(formatDepthYAxisLabel(15_000_000)).toBe('$15k');
    expect(formatDepthTooltipSbd(2500)).toBe('$2.500');
  });

  it('returns null when order book is empty', () => {
    expect(buildDepthChartModel([], [])).toBeNull();
  });
});
