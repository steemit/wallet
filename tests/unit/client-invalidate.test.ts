import { describe, it, expect, beforeEach } from 'vitest';

import { clientCache } from '@/lib/cache/client-cache';
import { invalidateWalletCache } from '@/lib/cache/client-invalidate';

// The URL templates below mirror the EXACT call sites that write these cache
// keys (grep the template literals when updating). If a hook changes its URL
// shape, this test must change with it — that coupling is the point:
// invalidateWalletCache only works while it tracks the real producers.
//
//   /api/query/accounts?names=            — use-steem-wallet-balances, use-account-data
//   /api/query/wallet-estimate-extras     — use-wallet-estimated-value
//                                           (includeOpenOrders both variants)
//   /api/query/withdraw-routes            — client.ts getWithdrawRoutes
//   /api/query/vesting-delegations        — use-delegations
describe('invalidateWalletCache', () => {
  beforeEach(() => {
    clientCache.clear();
  });

  it('evicts every L1 entry the wallet hooks wrote for the account', () => {
    const alice = encodeURIComponent('alice');
    clientCache.set(`/api/query/accounts?names=${alice}`, { v: 1 }, 60_000, 120_000);
    clientCache.set(
      `/api/query/wallet-estimate-extras?username=${alice}&includeOpenOrders=true`,
      { v: 1 },
      60_000,
      120_000
    );
    clientCache.set(
      `/api/query/wallet-estimate-extras?username=${alice}&includeOpenOrders=false`,
      { v: 1 },
      60_000,
      120_000
    );
    clientCache.set(`/api/query/withdraw-routes?username=${alice}`, { v: 1 }, 60_000, 120_000);
    clientCache.set(`/api/query/vesting-delegations?account=${alice}`, { v: 1 }, 60_000, 120_000);

    invalidateWalletCache('alice');

    expect(clientCache.get(`/api/query/accounts?names=${alice}`)).toBeNull();
    expect(
      clientCache.get(`/api/query/wallet-estimate-extras?username=${alice}&includeOpenOrders=true`)
    ).toBeNull();
    expect(
      clientCache.get(`/api/query/wallet-estimate-extras?username=${alice}&includeOpenOrders=false`)
    ).toBeNull();
    expect(clientCache.get(`/api/query/withdraw-routes?username=${alice}`)).toBeNull();
    expect(clientCache.get(`/api/query/vesting-delegations?account=${alice}`)).toBeNull();
  });

  it('leaves other accounts and shared endpoints untouched', () => {
    const bob = encodeURIComponent('bob');
    clientCache.set(`/api/query/accounts?names=${bob}`, { v: 2 }, 60_000, 120_000);
    clientCache.set('/api/query/global-props', { v: 3 }, 60_000, 120_000);

    invalidateWalletCache('alice');

    expect(clientCache.get(`/api/query/accounts?names=${bob}`)).not.toBeNull();
    expect(clientCache.get('/api/query/global-props')).not.toBeNull();
  });

  it('handles names that need URI encoding (sub-accounts)', () => {
    const name = 'alice.sub';
    const encoded = encodeURIComponent(name);
    clientCache.set(`/api/query/accounts?names=${encoded}`, { v: 1 }, 60_000, 120_000);

    invalidateWalletCache(name);

    expect(clientCache.get(`/api/query/accounts?names=${encoded}`)).toBeNull();
  });
});
