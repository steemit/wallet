export type MarketOrderSide = 'bids' | 'asks';

export interface RawOrderBookEntry {
  real_price?: string | number;
  steem?: string | number;
  sbd?: string | number;
  created?: string;
}

export interface MarketOrderRow {
  side: MarketOrderSide;
  price: number;
  stringPrice: string;
  steem: number;
  sbd: number;
}

export interface MarketTicker {
  latest: number;
  lowest_ask: number;
  highest_bid: number;
  percent_change: number;
  steem_volume: number;
  sbd_volume: number;
}

export interface MarketTradeRow {
  date: Date;
  type: 'bid' | 'ask';
  steem: number;
  sbd: number;
  price: number;
  stringPrice: string;
}

export interface MarketOpenOrderRow {
  orderid: number;
  created: string;
  type: 'bid' | 'ask';
  steem: number;
  sbd: number;
  price: number;
}

export type OpenOrdersSortColumn = 'created' | 'type' | 'price' | 'steem' | 'sbd';
export type OpenOrdersSortDir = 'asc' | 'desc';
