/**
 * fetchAccounts — the single client-side fetch path for /api/query/accounts
 * (finding G-13). Pins the consolidation contract: one URL builder
 * (normalized + encoded names, byte-compatible with invalidateWalletCache's
 * keys), one default cache policy (10s/60s SWR via cachedFetch), in-flight
 * dedup so concurrent callers share one network request, and fresh/noStore
 * bypass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  accountsQueryUrl,
  clearInFlightAccountRequests,
  fetchAccounts,
} from '@/lib/steem/accounts-client';
import { clientCache } from '@/lib/cache/client-cache';

const mockFetch = vi.fn();

function okResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('accountsQueryUrl', () => {
  it('normalizes and encodes each name', () => {
    expect(accountsQueryUrl(['@Alice'])).toBe('/api/query/accounts?names=alice');
    expect(accountsQueryUrl(['alice', 'Bob'])).toBe('/api/query/accounts?names=alice,bob');
  });

  it('keeps the single-name form byte-identical to invalidateWalletCache keys', async () => {
    const { invalidateWalletCache } = await import('@/lib/cache/client-invalidate');
    const key = accountsQueryUrl(['@Alice']);
    clientCache.set(key, { v: 1 }, 60_000, 120_000);
    invalidateWalletCache('Alice');
    expect(clientCache.get(key)).toBeNull();
  });
});

describe('fetchAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientCache.clear();
    clearInFlightAccountRequests();
    mockFetch.mockReset();
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('global-props')) {
        return Promise.resolve(okResponse({ props: {} }));
      }
      return Promise.resolve(okResponse({ success: true, accounts: [{ name: 'alice' }] }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('deduplicates concurrent identical requests into one network call', async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(okResponse({ success: true, accounts: [{ name: 'alice' }] })), 20))
    );

    const [a, b, c] = await Promise.all([
      fetchAccounts(['alice']),
      fetchAccounts(['alice']),
      fetchAccounts(['@Alice']),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('serves a fresh L1 hit without a network call', async () => {
    await fetchAccounts(['alice']);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const again = await fetchAccounts(['alice']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(again.accounts?.[0]?.name).toBe('alice');
  });

  it('fresh requests bypass the cache and dedup entirely', async () => {
    await fetchAccounts(['alice']);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await fetchAccounts(['alice'], { fresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith('/api/query/accounts?names=alice', {
      cache: 'no-store',
    });
  });

  it('returns an error response without a network call for empty names', async () => {
    const res = await fetchAccounts(['', '@']);
    expect(res.success).toBe(false);
    expect(res.accounts).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clearInFlightAccountRequests drops a pending deduped request', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    mockFetch.mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); })
    );

    const first = fetchAccounts(['alice']);
    clearInFlightAccountRequests();
    // A new caller after the clear must issue its own request, not join the
    // cleared one.
    const second = fetchAccounts(['alice']);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    for (const resolve of resolvers) {
      resolve(okResponse({ success: true, accounts: [{ name: 'alice' }] }));
    }
    await Promise.all([first, second]);
  });
});
