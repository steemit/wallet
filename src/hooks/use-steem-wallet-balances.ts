'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
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

        const [accountsResponse, propsResponse] = await Promise.all([
          apiClient.getAccounts([username]),
          apiClient.getGlobalProps(),
        ]);

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
