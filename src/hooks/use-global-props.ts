'use client';

import { useEffect, useState } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';

/**
 * Global properties for SP/VESTS math (delegate form, power down). Same
 * error-surface contract as the sibling data hooks: `error` is '' while
 * fine and a short message after a failed fetch, so consumers can tell
 * "still loading" apart from "failed" instead of watching a permanently
 * disabled form.
 */
export function useGlobalProps() {
  const [globalProps, setGlobalProps] = useState<GlobalPropsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchProps = async () => {
      try {
        setLoading(true);
        setError('');
        const { data } = await cachedFetch<{ props: GlobalPropsData; error?: string }>(
          '/api/query/global-props',
          { staleMs: 3_000, maxAgeMs: 30_000 }
        );
        if (cancelled) return;
        if (!data?.props) {
          setGlobalProps(null);
          setError(data?.error || 'Failed to fetch global properties');
          return;
        }
        setGlobalProps(data.props);
      } catch {
        if (cancelled) return;
        setGlobalProps(null);
        setError('Failed to fetch global properties');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchProps();
    return () => {
      cancelled = true;
    };
  }, []);

  return { globalProps, loading, error };
}
