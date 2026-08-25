/** External URLs aligned with wallet-legacy SidePanel. */
export const SIDE_PANEL_EXTERNAL = {
  binance: 'https://www.binance.com/en/trade/STEEM_USDT?type=spot',
  poloniex: 'https://www.poloniex.com/zh-CN/trade/STEEM_USDT?type=spot',
  apiDocs: 'https://developers.steem.io/',
  bluepaper: 'https://steem.io/steem-bluepaper.pdf',
  whitepaper: 'https://steem.io/SteemWhitePaper.pdf',
} as const;

export const SIDE_PANEL_INTERNAL = {
  faq: '/faq',
  market: '/market',
  recoverAccount: '/recover_account_step_1',
  witnesses: '/witnesses',
  proposals: '/proposals',
  about: '/about',
  privacy: '/privacy',
  terms: '/tos',
  support: '/support',
} as const;
