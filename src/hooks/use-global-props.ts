'use client';

import { useEffect, useState } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';

export function useGlobalProps() {
  const [globalProps, setGlobalProps] = useState<GlobalPropsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProps = async () => {
      try {
        setLoading(true);
        const { data } = await cachedFetch<{ props: GlobalPropsData; error?: string }>(
          '/api/query/global-props',
          { staleMs: 3_000, maxAgeMs: 30_000 }
        );
        setGlobalProps(data?.props ?? null);
      } catch {
        setGlobalProps(null);
      } finally {
        setLoading(false);
      }
    };

    void fetchProps();
  }, []);

  return { globalProps, loading };
}
