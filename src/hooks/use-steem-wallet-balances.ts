'use client';

import { useEffect, useRef, useState } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import { fetchAccounts } from '@/lib/steem/accounts-client';
import type { SteemAccount } from '@/lib/steem/types';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

export function useSteemWalletBalances(username: string, refreshNonce = 0) {
  const [balance, setBalance] = useState<WalletBalanceData | null>(null);
  const [globalProps, setGlobalProps] = useState<GlobalPropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!username?.trim()) {
      // Bump so any in-flight request for a previous username is dropped.
      requestIdRef.current += 1;
      void Promise.resolve().then(() => {
        setBalance(null);
        setGlobalProps(null);
        setLoading(false);
      });
      return;
    }

    // Race guard (docs/AI-driver/06 rule 1): a response for a previous
    // username/nonce must never overwrite the current snapshot.
    const requestId = ++requestIdRef.current;

    const fetchData = async () => {
      try {
        setLoading(true);

        const [accountsResponse, propsResult] = await Promise.all([
          fetchAccounts([username]),
          cachedFetch<{ props: GlobalPropsData; error?: string }>(
            '/api/query/global-props',
            { staleMs: 3_000, maxAgeMs: 30_000 }
          ),
        ]);

        if (requestId !== requestIdRef.current) return;

        const propsResponse = propsResult?.data;

        if (accountsResponse.error || !accountsResponse.accounts?.length) {
          console.warn(accountsResponse.error || 'Failed to fetch balance');
          setBalance(null);
          return;
        }

        const account = accountsResponse.accounts[0] as SteemAccount;
        setBalance(account);
        if (propsResponse?.error || !propsResponse?.props) {
          console.warn(propsResponse?.error || 'Failed to fetch global props');
          setGlobalProps(null);
          return;
        }
        setGlobalProps(propsResponse.props as unknown as GlobalPropsData);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        console.warn('Error fetching balance:', err);
        setBalance(null);
        setGlobalProps(null);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    };

    void fetchData();
  }, [username, refreshNonce]);

  return { balance, globalProps, loading };
}
