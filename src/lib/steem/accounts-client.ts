'use client';

import { cachedFetch } from '@/lib/cache/client-fetch';
import { normalizeSteemUsername } from '@/lib/steem/username';
import type { SteemAccount } from '@/lib/steem/types';

/**
 * THE single client-side fetch path for /api/query/accounts.
 *
 * Before this module existed the endpoint had six call sites with four
 * caching strategies (raw no-store fetch, cachedFetch 10s/60s, 30s/120s,
 * 60s/300s, plus noStore variants), so one transfers-page mount fired 3-4
 * identical requests and each consumer saw a different freshness window.
 * Everything now goes through here: one URL builder, one default cache
 * policy, one in-flight request per URL.
 */

/** Default L1 policy: 10s fresh, 60s usable-stale (SWR). */
export const ACCOUNTS_STALE_MS = 10_000;
export const ACCOUNTS_MAX_AGE_MS = 60_000;

export interface AccountsResponse {
  success?: boolean;
  accounts?: SteemAccount[];
  error?: string;
}

export interface FetchAccountsOptions {
  /**
   * Skip the L1 cache and dedup entirely (network-only). For flows that must
   * observe their own just-broadcast state: login challenge key lookup,
   * recovery step 1, post-broadcast refetches, and on-open money forms.
   */
  fresh?: boolean;
}

/**
 * Canonical query URL. Names are normalized (#341: one identity per account
 * whatever casing the caller had) and each name is encoded — the old
 * comma-join forgot to encode, which breaks for any name needing escaping
 * and keeps this builder's single-name output byte-identical to the keys
 * invalidateWalletCache drops (`/api/query/accounts?names=<encoded>`).
 */
export function accountsQueryUrl(names: readonly string[]): string {
  const encoded = names.map((n) => encodeURIComponent(normalizeSteemUsername(n)));
  return `/api/query/accounts?names=${encoded.join(',')}`;
}

/**
 * Concurrent identical requests share one network round trip. Without this,
 * cachedFetch's miss path fires one fetch per caller: a transfers-page mount
 * (balances hook + recovery banner + profile banner) triple-fetches.
 */
const inFlight = new Map<string, Promise<AccountsResponse>>();

/** Drop pending in-flight requests (called with L1 invalidation). */
export function clearInFlightAccountRequests(): void {
  inFlight.clear();
}

export async function fetchAccounts(
  names: readonly string[],
  options?: FetchAccountsOptions
): Promise<AccountsResponse> {
  const normalized = names.map((n) => normalizeSteemUsername(n)).filter(Boolean);
  if (normalized.length === 0) {
    return { success: false, accounts: [], error: 'No account names provided' };
  }

  const url = accountsQueryUrl(normalized);
  const mode = options?.fresh ? 'fresh' : 'cached';
  const dedupeKey = `${mode}:${url}`;

  const pending = inFlight.get(dedupeKey);
  if (pending) return pending;

  const request = (async (): Promise<AccountsResponse> => {
    try {
      const { data } = await cachedFetch<AccountsResponse>(
        url,
        options?.fresh
          ? { staleMs: 0, maxAgeMs: 0, noStore: true }
          : { staleMs: ACCOUNTS_STALE_MS, maxAgeMs: ACCOUNTS_MAX_AGE_MS }
      );
      return data;
    } finally {
      inFlight.delete(dedupeKey);
    }
  })();

  inFlight.set(dedupeKey, request);
  return request;
}
