/**
 * Market display components (orderbook / trade history / open orders / order
 * form). These files only entered the coverage pool once a page-level test
 * began importing them, so their rendering and interaction branches are
 * exercised directly here: pagination, price click-through, sort toggles,
 * cancel, and the order form's derived-field + warning logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarketOrderbook } from '@/components/market/market-orderbook';
import { MarketTradeHistory } from '@/components/market/market-trade-history';
import { MarketOpenOrders } from '@/components/market/market-open-orders';
import { MarketOrderForm } from '@/components/market/market-order-form';
import type {
  MarketOpenOrderRow,
  MarketOrderRow,
  MarketTicker,
  MarketTradeRow,
} from '@/lib/market/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const ticker: MarketTicker = {
  latest: 1,
  lowest_ask: 1.1,
  highest_bid: 0.9,
  percent_change: 0,
  steem_volume: 0,
  sbd_volume: 0,
};

function orderRow(price: number, steem: number, sbd: number): MarketOrderRow {
  return { side: 'bids', price, stringPrice: price.toFixed(6), steem, sbd };
}

function tradeRow(i: number): MarketTradeRow {
  return {
    date: new Date(`2026-01-01T12:00:${String(i).padStart(2, '0')}Z`),
    type: i % 2 === 0 ? 'bid' : 'ask',
    steem: 1,
    sbd: 1,
    price: 1,
    stringPrice: '1.000000',
  };
}

function openOrder(orderid: number): MarketOpenOrderRow {
  return {
    orderid,
    created: `2026-01-0${(orderid % 9) + 1}T00:00:00`,
    type: orderid % 2 === 0 ? 'bid' : 'ask',
    steem: orderid,
    sbd: orderid,
    price: orderid,
  };
}

describe('MarketOrderbook', () => {
  it('renders cumulative rows, paginates, and reports price clicks', () => {
    const onPriceClick = vi.fn();
    const orders = Array.from({ length: 12 }, (_, i) => orderRow(1 + i * 0.1, 10, 5));
    render(<MarketOrderbook side="bids" orders={orders} onPriceClick={onPriceClick} />);

    // First page shows 10 of 12 rows.
    expect(screen.getAllByText('$1.100000')).toHaveLength(1);
    expect(screen.queryByText('$2.100000')).toBeNull();

    // Row click reports the price (order book click-through to the form).
    fireEvent.click(screen.getByText('$1.100000'));
    expect(onPriceClick).toHaveBeenCalledWith(1.1);

    // Pagination: forward to the last page, then back.
    fireEvent.click(screen.getByRole('button', { name: /lower →/ }));
    expect(screen.getByText('$2.100000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /← higher/ }));
    expect(screen.queryByText('$2.100000')).toBeNull();
  });

  it('renders the asks column order', () => {
    render(
      <MarketOrderbook side="asks" orders={[orderRow(2, 10, 5)]} onPriceClick={() => {}} />
    );
    // Asks put the price first; the rose class is asserted via presence only.
    expect(screen.getByText('$2.000000')).toBeInTheDocument();
  });
});

describe('MarketTradeHistory', () => {
  it('renders fills and paginates newer/older', () => {
    const history = Array.from({ length: 12 }, (_, i) => tradeRow(i));
    render(<MarketTradeHistory history={history} />);

    expect(screen.getAllByText('$1.000000')).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: /older →/ }));
    expect(screen.getAllByText('$1.000000')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /← newer/ }));
    expect(screen.getAllByText('$1.000000')).toHaveLength(10);
  });
});

describe('MarketOpenOrders', () => {
  it('sorts by every column and dispatches cancel', () => {
    const onCancel = vi.fn();
    render(
      <MarketOpenOrders
        orders={[openOrder(3), openOrder(1), openOrder(2)]}
        onCancel={onCancel}
        cancellingId={null}
      />
    );

    // Initial sort: created desc (orderid 3 first).
    const rows = () => screen.getAllByRole('row').slice(1); // skip header
    expect(rows()[0]).toHaveTextContent('$3.000000');

    // Toggle created -> asc puts orderid 1 first.
    fireEvent.click(screen.getByRole('columnheader', { name: /dateCreated/ }));
    expect(rows()[0]).toHaveTextContent('$1.000000');

    // Every remaining column toggles the sort as well.
    for (const name of ['type', 'price', 'STEEM', 'SBD']) {
      fireEvent.click(screen.getByRole('columnheader', { name: new RegExp(name) }));
    }
    // Last sort: SBD desc -> orderid 3 first.
    expect(rows()[0]).toHaveTextContent('$3.000000');

    fireEvent.click(screen.getAllByRole('button', { name: 'cancelOrder' })[0]!);
    expect(onCancel).toHaveBeenCalledWith(3);
  });
});

interface OrderFormPayload {
  price: number;
  amount: number;
  total: number;
  priceWarning: boolean;
  marketRefPrice: number;
}

function renderBuyForm(onSubmit: (payload: OrderFormPayload) => Promise<void>) {
  render(
    <MarketOrderForm
      side="buy"
      ticker={ticker}
      steemBalance="100.000 STEEM"
      sbdBalance="100.000 SBD"
      disabled={false}
      onSubmit={onSubmit}
    />
  );
}

describe('MarketOrderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives total from amount and flags far-from-market prices', async () => {
    const onSubmit = vi.fn(async (_payload: OrderFormPayload) => {});
    renderBuyForm(onSubmit);

    const amount = screen.getByLabelText('amount');
    fireEvent.change(amount, { target: { value: '5' } });
    // total = roundUp(1.1 * 5, 3) = 5.500
    expect((screen.getByLabelText('total') as HTMLInputElement).value).toBe('5.500');

    // Move the price far above the market (lowest_ask 1.1) -> price warning.
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: 'buySteem' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ priceWarning: true, marketRefPrice: 1.1 })
      );
    });
  });

  it('derives amount from total and submits near-market prices without warning', async () => {
    const onSubmit = vi.fn(async (_payload: OrderFormPayload) => {});
    renderBuyForm(onSubmit);

    fireEvent.change(screen.getByLabelText('total'), { target: { value: '2.2' } });
    // amount = roundDown(2.2 / 1.1, 3) = 2.000
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('2.000');

    fireEvent.click(screen.getByRole('button', { name: 'buySteem' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ priceWarning: false, amount: 2 })
      );
    });
  });

  it('fillAvailable and snapMarketPrice seed the form from balances/ticker', () => {
    const onSubmit = vi.fn(async (_payload: OrderFormPayload) => {});
    renderBuyForm(onSubmit);

    fireEvent.click(screen.getByRole('button', { name: /available/ }));
    // Buy: fills total with the SBD balance and derives the amount.
    expect((screen.getByLabelText('total') as HTMLInputElement).value).toBe('100.000');
    expect((screen.getByLabelText('amount') as HTMLInputElement).value).toBe('90.909');

    fireEvent.click(screen.getByRole('button', { name: /lowestAsk/ }));
    expect((screen.getByLabelText('price') as HTMLInputElement).value).toBe('1.100000');
  });
});
