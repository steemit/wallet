import { describe, expect, it } from 'vitest';
import {
  buildDepthChartModel,
  buildDepthSeries,
  formatDepthTooltipSbd,
  formatDepthYAxisLabel,
  getDepthPriceDomain,
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
  it('builds padded bid/ask series like legacy', () => {
    const bids = [row('bids', 0.5, 10, 20)];
    const asks = [row('asks', 0.55, 5, 9)];
    const { bids: bidSeries, asks: askSeries } = buildDepthSeries(bids, asks);

    expect(bidSeries[0]?.price).toBe(0);
    expect(bidSeries[0]?.cumulativeSbd).toBe(bidSeries[1]?.cumulativeSbd);
    expect(askSeries[askSeries.length - 1]?.price).toBeCloseTo(0.55 * 4);
  });

  it('computes price domain between bid and ask', () => {
    const bids = [row('bids', 0.9, 1, 1), row('bids', 1.0, 1, 1)];
    const asks = [row('asks', 1.1, 1, 1)];
    const { bids: bidSeries, asks: askSeries } = buildDepthSeries(bids, asks);
    const domain = getDepthPriceDomain(bidSeries, askSeries);

    expect(domain.min).toBeLessThan(1.0);
    expect(domain.max).toBeGreaterThan(1.1);
  });

  it('merges chart rows for Recharts', () => {
    const model = buildDepthChartModel(
      [row('bids', 1, 2, 2)],
      [row('asks', 1.2, 3, 2.5)]
    );
    expect(model?.chartData.length).toBeGreaterThan(2);
    expect(model?.chartData.some((p) => p.bidDepth != null)).toBe(true);
    expect(model?.chartData.some((p) => p.askDepth != null)).toBe(true);
  });

  it('formats axis and tooltip like legacy', () => {
    expect(formatDepthYAxisLabel(15_000_000)).toBe('$15k');
    expect(formatDepthTooltipSbd(2500)).toBe('$2.500');
  });

  it('returns null when order book is empty', () => {
    expect(buildDepthChartModel([], [])).toBeNull();
  });
});
