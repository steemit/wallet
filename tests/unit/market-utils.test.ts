import { describe, expect, it } from 'vitest';
import {
  aggregateOrderBookRows,
  formatAssetAmount,
  marketSpreadPercent,
  percentDiff,
  roundDown,
  roundUp,
} from '@/lib/market/utils';
import type { MarketOrderRow } from '@/lib/market/types';

describe('market utils', () => {
  it('roundUp and roundDown match legacy precision behavior', () => {
    expect(roundUp(1.2344, 3)).toBe(1.235);
    expect(roundDown(1.2346, 3)).toBe(1.234);
  });

  it('aggregates order book rows with the same display price', () => {
    const rows: MarketOrderRow[] = [
      { side: 'bids', price: 0.5, stringPrice: '0.500', steem: 1, sbd: 0.5 },
      { side: 'bids', price: 0.5, stringPrice: '0.500', steem: 2, sbd: 1 },
      { side: 'bids', price: 0.51, stringPrice: '0.510', steem: 1, sbd: 0.51 },
    ];
    const merged = aggregateOrderBookRows(rows);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.steem).toBe(3);
    expect(merged[0]?.sbd).toBe(1.5);
  });

  it('computes spread percent', () => {
    const spread = marketSpreadPercent({ lowest_ask: 1.1, highest_bid: 1 });
    expect(spread).not.toBeNull();
    expect(spread!).toBeCloseTo(9.524, 2);
    expect(marketSpreadPercent({ lowest_ask: 1, highest_bid: 0 })).toBeNull();
  });

  it('computes percent diff for price warnings', () => {
    expect(percentDiff(1, 1.2)).toBeCloseTo(20);
    expect(percentDiff(1, 0.8)).toBeCloseTo(-20);
    expect(percentDiff(0, 1)).toBe(0);
  });

  it('formats asset amounts for chain operations', () => {
    expect(formatAssetAmount(1.2345, 'STEEM')).toBe('1.234 STEEM');
  });
});
