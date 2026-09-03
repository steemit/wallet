/**
 * Overseer payload builders matching wallet-legacy ServerApiClient.js.
 *
 * Legacy called `api.call('overseer.collect', ['custom', { measurement, fields, tags }])`
 * from the browser (jussi routes `overseer.*` to the overseer service). The rewrite
 * reconstructs the same payload on the server and relays it so browsers do not
 * talk to api.steemit.com directly.
 *
 * Whale lookup lowercases `transferCoin` (`STEEM` → `steem`). Legacy compared
 * against `whaleThreshold[params.transferCoin]` whose keys were lowercase, so
 * STEEM/SBD transfers never tagged as whale. That was a bug; the config intent
 * (`steem_whale` / `sbd_whale`) is preserved here.
 */

export const OVERSEER_USER_ACTIONS = [
  'transfer',
  'change_password',
  'recovery_account',
  'withdraw_vesting',
  'cancel_withdraw_vesting',
  'cancel_transfer_from_savings',
  'transfer_to_vesting',
  'transfer_to_savings',
  'transfer_from_savings',
  'delegate_vesting_shares',
  'account_witness_vote',
  'account_witness_proxy',
] as const;

export type OverseerUserAction = (typeof OVERSEER_USER_ACTIONS)[number];

export const OVERSEER_ROUTE_TAGS = [
  'index',
  'login',
  'market',
  'proposals',
  'vote_to_witness',
  'privacy',
  'tos',
  'faq',
  'about',
  'support',
  'recover_account_step1',
  'recover_account_step2',
  'user_index',
  'change_password',
  'not_found',
] as const;

export type OverseerRouteTag = (typeof OVERSEER_ROUTE_TAGS)[number];

export type OverseerTags = Record<string, string | boolean>;
export type OverseerFields = Record<string, string | number>;

export interface OverseerCustomPayload {
  measurement: string;
  tags: OverseerTags;
  fields: OverseerFields;
}

export interface WhaleThresholds {
  steem: number;
  sbd: number;
}

export const DEFAULT_WHALE_THRESHOLDS: WhaleThresholds = {
  steem: 10000,
  sbd: 500,
};

export interface UserActionParams {
  username?: string;
  from?: string;
  to?: string;
  amount?: string | number;
  transferCoin?: string;
  witness?: string;
  proxy?: string;
}

export interface RouteTagParams {
  accountname?: string;
}

const ACTION_SET: ReadonlySet<string> = new Set(OVERSEER_USER_ACTIONS);
const TAG_SET: ReadonlySet<string> = new Set(OVERSEER_ROUTE_TAGS);

export function isOverseerUserAction(value: string): value is OverseerUserAction {
  return ACTION_SET.has(value);
}

export function isOverseerRouteTag(value: string): value is OverseerRouteTag {
  return TAG_SET.has(value);
}

/** Steem account names are 3–16 chars: leading letter, then [a-z0-9.-]. */
export const STEEM_ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;

export function isSteemAccountName(value: string): boolean {
  return STEEM_ACCOUNT_RE.test(value);
}

/** Legacy session uid: 13 random bytes as hex (26 chars). Allow 8–32 hex. */
export const TRACKING_ID_RE = /^[a-f0-9]{8,32}$/;

export function isTrackingId(value: string): boolean {
  return TRACKING_ID_RE.test(value);
}

export function amountNumber(amount: string | number | undefined): number {
  if (typeof amount === 'number') return Number.isFinite(amount) ? amount : 0;
  if (typeof amount !== 'string') return 0;
  const raw = parseFloat(amount.trim().split(' ')[0] ?? '');
  return Number.isFinite(raw) ? raw : 0;
}

function whaleFlag(amount: string | number | undefined, coin: string | undefined, thresholds: WhaleThresholds): string {
  if (!coin) return 'false';
  const key = coin.toLowerCase();
  const threshold = key === 'steem' ? thresholds.steem : key === 'sbd' ? thresholds.sbd : undefined;
  if (threshold === undefined) return 'false';
  return (amountNumber(amount) > threshold).toString();
}

/**
 * Static routes first (several of these strings are also valid Steem account
 * names, e.g. `market`). Remaining `/<account>` paths map to `user_index`.
 */
const EXACT_ROUTE_TAGS: Record<string, OverseerRouteTag> = {
  '/': 'index',
  '/login': 'login',
  '/market': 'market',
  '/proposals': 'proposals',
  '/witnesses': 'vote_to_witness',
  '/privacy': 'privacy',
  '/tos': 'tos',
  '/faq': 'faq',
  '/about': 'about',
  '/support': 'support',
  '/recover_account_step_1': 'recover_account_step1',
};

export function routeTagFromPathname(pathname: string): {
  tag: OverseerRouteTag;
  params?: RouteTagParams;
} {
  const path = (pathname.replace(/\/+$/, '') || '/') as string;
  const exact = EXACT_ROUTE_TAGS[path];
  if (exact) return { tag: exact };

  if (/^\/account_recovery_confirmation\/[^/]+$/.test(path)) {
    return { tag: 'recover_account_step2' };
  }

  const userMatch = /^\/([^/]+)(?:\/(.*))?$/.exec(path);
  const account = userMatch?.[1];
  if (userMatch && account && isSteemAccountName(account)) {
    const rest = userMatch[2];
    if (rest === 'settings') {
      return { tag: 'change_password', params: { accountname: account } };
    }
    return { tag: 'user_index', params: { accountname: account } };
  }

  return { tag: 'not_found' };
}

export function buildRoutePayload(
  trackingId: string,
  tag: OverseerRouteTag,
  params: RouteTagParams | undefined,
  isLogin: boolean
): OverseerCustomPayload {
  const tags: OverseerTags = {
    app: 'wallet',
    tag,
    is_login: isLogin,
  };
  const fields: OverseerFields =
    tag === 'user_index' && params?.accountname
      ? { trackingId, permlink: params.accountname }
      : { trackingId };
  return { measurement: 'route', tags, fields };
}

export function buildUserActionPayload(
  action: OverseerUserAction,
  params: UserActionParams,
  thresholds: WhaleThresholds = DEFAULT_WHALE_THRESHOLDS
): OverseerCustomPayload {
  let tags: OverseerTags = {
    app: 'wallet',
    action_type: action,
  };
  let fields: OverseerFields = {};

  switch (action) {
    case 'transfer':
      tags = {
        app: 'wallet',
        action_type: action,
        transfer_coin: String(params.transferCoin ?? ''),
        whale: whaleFlag(params.amount, params.transferCoin, thresholds),
      };
      fields = {
        from_username: String(params.from ?? ''),
        to_username: String(params.to ?? ''),
        amount: amountNumber(params.amount),
      };
      break;
    case 'change_password':
      fields = { username: String(params.username ?? '') };
      break;
    case 'recovery_account':
      fields = { username: String(params.username ?? '') };
      break;
    case 'withdraw_vesting':
      tags = {
        app: 'wallet',
        action_type: action,
        whale: whaleFlag(params.amount, 'steem', thresholds),
      };
      fields = {
        username: String(params.username ?? ''),
        amount: amountNumber(params.amount),
      };
      break;
    case 'cancel_withdraw_vesting':
      tags = { app: 'wallet', action_type: action };
      fields = { username: String(params.username ?? '') };
      break;
    case 'cancel_transfer_from_savings':
      fields = { username: String(params.username ?? '') };
      break;
    case 'transfer_to_vesting':
      tags = {
        app: 'wallet',
        action_type: action,
        whale: whaleFlag(params.amount, 'steem', thresholds),
      };
      fields = {
        from_username: String(params.from ?? ''),
        to_username: String(params.to ?? ''),
        amount: amountNumber(params.amount),
      };
      break;
    case 'transfer_to_savings':
    case 'transfer_from_savings':
    case 'delegate_vesting_shares':
      tags = {
        app: 'wallet',
        action_type: action,
        transfer_coin: String(params.transferCoin ?? ''),
        whale: whaleFlag(params.amount, params.transferCoin, thresholds),
      };
      fields = {
        from_username: String(params.from ?? ''),
        to_username: String(params.to ?? ''),
        amount: amountNumber(params.amount),
      };
      break;
    case 'account_witness_vote':
      fields = {
        username: String(params.username ?? ''),
        witness: String(params.witness ?? ''),
      };
      break;
    case 'account_witness_proxy':
      fields = {
        username: String(params.username ?? ''),
        proxy: String(params.proxy ?? ''),
      };
      break;
  }

  return { measurement: 'user_action', tags, fields };
}

export function buildUserLoginPayload(username: string): OverseerCustomPayload {
  return {
    measurement: 'user_login',
    tags: { entry: 'wallet' },
    fields: { username },
  };
}

export function whaleThresholdsFromEnv(): WhaleThresholds {
  return {
    steem: parsePositiveNumber(process.env.STEEM_WHALE, DEFAULT_WHALE_THRESHOLDS.steem),
    sbd: parsePositiveNumber(process.env.SBD_WHALE, DEFAULT_WHALE_THRESHOLDS.sbd),
  };
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
