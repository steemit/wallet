/** Steem internal market asset symbols (legacy wallet / chain). */
export const STEEM_SYMBOL = 'STEEM';
export const SBD_SYMBOL = 'SBD';

/** Order book amounts from the API are stored as integers at this precision. */
export const MARKET_AMOUNT_PRECISION = 1000;

/** Limit orders expire after 27 days (chain rejects >28 days from head). */
export const DEFAULT_LIMIT_ORDER_EXPIRATION_SEC = 60 * 60 * 24 * 27;

export const MARKET_POLL_INTERVAL_MS = 3000;
export const ORDERBOOK_LIMIT = 500;
export const RECENT_TRADES_LIMIT = 25;
