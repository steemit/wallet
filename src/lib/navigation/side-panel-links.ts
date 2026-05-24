/** External URLs aligned with wallet-legacy SidePanel. */
export const SIDE_PANEL_EXTERNAL = {
  binance: 'https://www.binance.com/en/trade/STEEM_BTC',
  poloniex: 'https://poloniex.com/trade/STEEM_TRX/?type=spot',
  apiDocs: 'https://developers.steem.io/',
  bluepaper: 'https://steem.io/steem-bluepaper.pdf',
  smtWhitepaper: 'https://smt.steem.io/',
  whitepaper: 'https://steem.io/SteemWhitePaper.pdf',
} as const;

export const SIDE_PANEL_INTERNAL = {
  faq: '/faq',
  market: '/market',
  recoverAccount: '/recover_account_step_1',
  changePassword: '/change_password',
  witnesses: '/witnesses',
  proposals: '/proposals',
  about: '/about',
  privacy: '/privacy',
  terms: '/tos',
} as const;
