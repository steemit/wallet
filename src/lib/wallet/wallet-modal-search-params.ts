/**
 * URL query keys for wallet modals on /@username/transfers.
 * Single source of truth — do not duplicate string literals elsewhere.
 */

export const WALLET_ACTION_QUERY = 'walletAction';
export const WALLET_ASSET_QUERY = 'asset';
export const WALLET_TYPE_QUERY = 'type';

export const WALLET_QUERY_KEYS = [
  WALLET_ACTION_QUERY,
  WALLET_ASSET_QUERY,
  WALLET_TYPE_QUERY,
] as const;

export type WalletModalAction =
  | 'transfer'
  | 'powerDown'
  | 'delegate'
  | 'advanced'
  | 'convert';

/** Maps balance UI / legacy-style transfer flows to `type` query value. */
export type WalletTransferType =
  | 'transfer'
  | 'savings'
  | 'savings_withdraw'
  | 'power_up';

export function parseWalletModalAction(raw: string | null): WalletModalAction | null {
  if (!raw) return null;
  if (
    raw === 'transfer' ||
    raw === 'powerDown' ||
    raw === 'delegate' ||
    raw === 'advanced' ||
    raw === 'convert'
  ) {
    return raw;
  }
  return null;
}

export function parseWalletTransferType(raw: string | null): WalletTransferType | null {
  if (!raw) return null;
  if (
    raw === 'transfer' ||
    raw === 'savings' ||
    raw === 'savings_withdraw' ||
    raw === 'power_up'
  ) {
    return raw;
  }
  return null;
}

export function parseWalletAsset(raw: string | null): 'STEEM' | 'SBD' | 'VESTS' | null {
  if (raw === 'STEEM' || raw === 'SBD' || raw === 'VESTS') return raw;
  return null;
}

export function buildWalletModalSearchString(params: {
  walletAction: WalletModalAction;
  asset?: string;
  type?: string;
}): string {
  const sp = new URLSearchParams();
  sp.set(WALLET_ACTION_QUERY, params.walletAction);
  if (params.asset) sp.set(WALLET_ASSET_QUERY, params.asset);
  if (params.type) sp.set(WALLET_TYPE_QUERY, params.type);
  return sp.toString();
}

/**
 * Wallet transfers URL path: literal /@username/transfers (same idea as condenser).
 * Do not encode `@` — encodeURIComponent would turn it into %40 in the address bar.
 */
export function transfersPathForUsername(username: string): string {
  return `/@${username}/transfers`;
}

export function transfersHref(username: string, search?: string): string {
  const path = transfersPathForUsername(username);
  return search ? `${path}?${search}` : path;
}
