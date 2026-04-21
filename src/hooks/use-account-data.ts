'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { apiClient } from '@/lib/steem/client';
import type { SteemAccount } from '@/lib/steem/types';

export type AccountInfo = SteemAccount;

export function useAccountData() {
  const username = useSelector((state: RootState) => state.auth.username);
  const [data, setData] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const refetch = useCallback(async () => {
    if (!username) return;

    try {
      setLoading(true);
      setError('');
      const response = await apiClient.getAccounts([username]);

      if (response.error || !response.accounts || response.accounts.length === 0) {
        setError(response.error || 'Failed to fetch account data');
        return;
      }

      setData(response.accounts[0] as unknown as AccountInfo);
    } catch (err) {
      console.error('Error fetching account data:', err);
      setError('Failed to fetch account data');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void Promise.resolve().then(refetch);
  }, [refetch]);

  return { data, loading, error, refetch };
}
