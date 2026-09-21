'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAccounts } from '@/lib/steem/accounts-client';
import { normalizeSteemUsername } from '@/lib/steem/username';
import type { SteemAccount } from '@/lib/steem/types';

export interface UseAccountOptions {
  /**
   * Always hit the network, skipping the shared L1 cache (see
   * lib/steem/accounts-client). Use where the caller must see its own
   * just-broadcast changes (settings/forms acting on balances, login key
   * lookup); leave off for read-only views happy to share cached data.
   */
  fresh?: boolean;
  /** Error string when the request fails without a server-provided reason. */
  errorMessage?: string;
}

/**
 * The shared single-account hook over fetchAccounts: one fetch path, one
 * cache policy, and a requestId race guard so a response for a previous
 * username can never overwrite the current one.
 */
export function useAccount(username: string, options?: UseAccountOptions) {
  const [data, setData] = useState<SteemAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const fresh = options?.fresh ?? false;
  const errorMessage = options?.errorMessage ?? 'Failed to fetch account';

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const name = normalizeSteemUsername(username);
    if (!name) {
      setData(null);
      setError('');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await fetchAccounts([name], fresh ? { fresh: true } : undefined);
      if (requestId !== requestIdRef.current) return;

      if (response.error || !response.accounts?.length) {
        setError(response.error || errorMessage);
        setData(null);
        return;
      }
      setData(response.accounts[0] ?? null);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError(errorMessage);
      setData(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [username, fresh, errorMessage]);

  useEffect(() => {
    // Deferred one microtask: refetch writes state synchronously for the
    // empty-username path, which trips react-hooks/set-state-in-effect.
    void Promise.resolve().then(refetch);
  }, [refetch]);

  return { data, loading, error, refetch };
}
