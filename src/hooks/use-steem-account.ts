'use client';

import { useCallback, useEffect, useState } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import type { SteemAccount } from '@/lib/steem/types';

export function useSteemAccount(username: string) {
  const [data, setData] = useState<SteemAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const refetch = useCallback(async () => {
    const name = username.trim().replace(/^@/, '');
    if (!name) {
      setData(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      const { data: response } = await cachedFetch<{
        accounts?: SteemAccount[];
        success?: boolean;
        error?: string;
      }>(`/api/query/accounts?names=${encodeURIComponent(name)}`, {
        staleMs: 10_000,
        maxAgeMs: 60_000,
        noStore: true,
      });

      if (response.error || !response.accounts?.length) {
        setError(response.error || 'Failed to fetch account');
        setData(null);
        return;
      }

      const acc = response.accounts[0];
      setData(acc ?? null);
    } catch {
      setError('Failed to fetch account');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void Promise.resolve().then(refetch);
  }, [refetch]);

  return { data, loading, error, refetch };
}
