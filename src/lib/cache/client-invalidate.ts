import { clientCache } from './client-cache';
import { normalizeSteemUsername } from '@/lib/steem/username';

/**
 * Drop the browser L1 cache entries holding this account's data.
 *
 * These are the EXACT URL keys the hooks/components fetch with (see
 * use-steem-wallet-balances, use-wallet-estimated-value, use-account-data,
 * use-delegations, client.ts getWithdrawRoutes). The wallet refresh nonce
 * alone is not enough: cachedFetch serves its fresh window without any
 * request, so after a successful broadcast the hooks would keep rendering
 * pre-broadcast data until the TTL lapses. Call this from the broadcast
 * success path (page.tsx wires it into onWalletDataChanged) before bumping
 * the nonce, and the nonce-triggered refetch then misses the cache and hits
 * the network.
 *
 * The market endpoint is intentionally absent from the key list: the market
 * page fetches via plain fetch (no L1 entries exist) and its server-side
 * cache is invalidated globally by the limit-order routes. The market page
 * still CALLS this helper after order placement/cancellation to drop the
 * user's wallet entries (orders lock balances and change extras).
 */
export function invalidateWalletCache(username: string): void {
  // Canonical form: the hooks build their URL keys from normalized names, so
  // invalidation must normalize too or it would miss every entry when called
  // with a differently-cased spelling of the same account.
  const u = encodeURIComponent(normalizeSteemUsername(username));
  clientCache.invalidate(`/api/query/accounts?names=${u}`);
  clientCache.invalidate(
    `/api/query/wallet-estimate-extras?username=${u}&includeOpenOrders=true`
  );
  clientCache.invalidate(
    `/api/query/wallet-estimate-extras?username=${u}&includeOpenOrders=false`
  );
  clientCache.invalidate(`/api/query/withdraw-routes?username=${u}`);
  clientCache.invalidate(`/api/query/vesting-delegations?account=${u}`);
}
