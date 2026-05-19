'use client';

import { useEffect, useState } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import type { SteemAccount } from '@/lib/steem/types';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

export function useSteemWalletBalances(username: string, refreshNonce = 0) {
  const [balance, setBalance] = useState<WalletBalanceData | null>(null);
  const [globalProps, setGlobalProps] = useState<GlobalPropsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username?.trim()) {
      void Promise.resolve().then(() => {
        setBalance(null);
        setGlobalProps(null);
        setLoading(false);
      });
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);

        const [accountsResult, propsResult] = await Promise.all([
          cachedFetch<{ accounts: SteemAccount[]; error?: string }>(
            `/api/query/accounts?names=${encodeURIComponent(username)}`,
            { staleMs: 10_000, maxAgeMs: 60_000 }
          ),
          cachedFetch<{ props: GlobalPropsData; error?: string }>(
            '/api/query/global-props',
            { staleMs: 3_000, maxAgeMs: 30_000 }
          ),
        ]);

        const accountsResponse = accountsResult.data;
        const propsResponse = propsResult.data;

        if (accountsResponse.error || !accountsResponse.accounts?.length) {
          console.error(accountsResponse.error || 'Failed to fetch balance');
          setBalance(null);
          return;
        }

        const account = accountsResponse.accounts[0] as SteemAccount;
        setBalance(account as unknown as WalletBalanceData);
        if (propsResponse.error) {
          console.error(propsResponse.error);
          setGlobalProps(null);
          return;
        }
        setGlobalProps(propsResponse.props as unknown as GlobalPropsData);
      } catch (err) {
        console.error('Error fetching balance:', err);
        setBalance(null);
        setGlobalProps(null);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [username, refreshNonce]);

  return { balance, globalProps, loading };
}
