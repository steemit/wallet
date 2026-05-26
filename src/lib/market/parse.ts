import {
  MARKET_AMOUNT_PRECISION,
  SBD_SYMBOL,
  STEEM_SYMBOL,
} from './constants';
import type {
  MarketOpenOrderRow,
  MarketOrderRow,
  MarketOrderSide,
  MarketTicker,
  MarketTradeRow,
  RawOrderBookEntry,
} from './types';
import { roundDown, roundUp } from './utils';

const STEEM_NAI = '@@000000021';
const SBD_NAI = '@@000000013';

function parseOrderBookEntry(raw: RawOrderBookEntry, side: MarketOrderSide): MarketOrderRow {
  let price = parseFloat(String(raw.real_price ?? 0));
  price =
    side === 'asks'
      ? roundUp(price, 6)
      : Math.max(roundDown(price, 6), 0.000001);
  const steem = parseInt(String(raw.steem ?? 0), 10) / MARKET_AMOUNT_PRECISION;
  const sbd = parseInt(String(raw.sbd ?? 0), 10) / MARKET_AMOUNT_PRECISION;
  return {
    side,
    price,
    stringPrice: price.toFixed(6),
    steem,
    sbd,
  };
}

export function parseOrderBook(raw: {
  bids?: RawOrderBookEntry[];
  asks?: RawOrderBookEntry[];
}): { bids: MarketOrderRow[]; asks: MarketOrderRow[] } {
  const bids = (raw.bids ?? []).map((o) => parseOrderBookEntry(o, 'bids'));
  const asks = (raw.asks ?? []).map((o) => parseOrderBookEntry(o, 'asks'));
  return { bids, asks };
}

export function parseTicker(raw: Record<string, unknown>): MarketTicker {
  const num = (k: string) => parseFloat(String(raw[k] ?? 0));
  return {
    latest: num('latest'),
    lowest_ask: num('lowest_ask'),
    highest_bid: num('highest_bid'),
    percent_change: num('percent_change'),
    steem_volume: num('steem_volume'),
    sbd_volume: num('sbd_volume'),
  };
}

function parseAssetStringAmount(value: string, symbol: string): number {
  const parts = value.trim().split(/\s+/);
  if (parts.length >= 2 && parts[1] === symbol) {
    return parseFloat(parts[0] ?? '0') || 0;
  }
  return 0;
}

function parseNaiTradeAmount(asset: {
  amount: string;
  precision: number;
  nai: string;
}): { steem: number; sbd: number } {
  const amount = parseFloat(asset.amount) / 10 ** asset.precision;
  if (asset.nai === STEEM_NAI) return { steem: amount, sbd: 0 };
  if (asset.nai === SBD_NAI) return { steem: 0, sbd: amount };
  return { steem: 0, sbd: 0 };
}

export function parseTradeFill(fill: Record<string, unknown>): MarketTradeRow | null {
  const dateRaw = fill.date;
  if (!dateRaw) return null;
  let zdate = String(dateRaw);
  if (!/Z$/i.test(zdate)) zdate += 'Z';
  const date = new Date(zdate);

  let steem = 0;
  let sbd = 0;
  let type: 'bid' | 'ask';

  const currentPays = fill.current_pays;
  const openPays = fill.open_pays;

  if (
    typeof currentPays === 'object' &&
    currentPays !== null &&
    'nai' in currentPays &&
    typeof openPays === 'object' &&
    openPays !== null &&
    'nai' in openPays
  ) {
    const cur = parseNaiTradeAmount(
      currentPays as { amount: string; precision: number; nai: string }
    );
    const open = parseNaiTradeAmount(
      openPays as { amount: string; precision: number; nai: string }
    );
    if (cur.sbd > 0 && open.steem > 0) {
      type = 'bid';
      sbd = cur.sbd;
      steem = open.steem;
    } else if (cur.steem > 0 && open.sbd > 0) {
      type = 'ask';
      steem = cur.steem;
      sbd = open.sbd;
    } else {
      return null;
    }
  } else {
    const currentStr = String(currentPays ?? '');
    const openStr = String(openPays ?? '');
    type = currentStr.includes(SBD_SYMBOL) ? 'bid' : 'ask';
    if (type === 'bid') {
      sbd = parseAssetStringAmount(currentStr, SBD_SYMBOL);
      steem = parseAssetStringAmount(openStr, STEEM_SYMBOL);
    } else {
      sbd = parseAssetStringAmount(openStr, SBD_SYMBOL);
      steem = parseAssetStringAmount(currentStr, STEEM_SYMBOL);
    }
  }

  if (steem <= 0) return null;

  let price = sbd / steem;
  price =
    type === 'ask'
      ? roundUp(price, 6)
      : Math.max(roundDown(price, 6), 0.000001);

  return {
    date,
    type,
    steem,
    sbd,
    price,
    stringPrice: price.toFixed(6),
  };
}

export function parseOpenOrder(raw: {
  orderid: number;
  created: string;
  sell_price: { base: string; quote: string };
  for_sale?: number;
}): MarketOpenOrderRow {
  const isAsk = raw.sell_price.base.includes(STEEM_SYMBOL);
  const steem = isAsk
    ? (raw.for_sale ?? 0) / MARKET_AMOUNT_PRECISION
    : parseFloat(raw.sell_price.quote.split(' ')[0] || '0');
  const sbd = isAsk
    ? parseFloat(raw.sell_price.quote.split(' ')[0] || '0')
    : (raw.for_sale ?? 0) / MARKET_AMOUNT_PRECISION;
  const price = steem > 0 ? sbd / steem : 0;
  return {
    orderid: raw.orderid,
    created: raw.created,
    type: isAsk ? 'ask' : 'bid',
    steem,
    sbd,
    price,
  };
}
