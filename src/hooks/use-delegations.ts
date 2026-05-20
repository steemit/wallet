'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { cachedFetch } from '@/lib/cache/client-fetch';
import type { VestingDelegation, ExpiringVestingDelegation } from '@/lib/steem/types';

export function useVestingDelegations(username: string) {
  const [delegations, setDelegations] = useState<VestingDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!username) {
      void Promise.resolve().then(() => {
        setDelegations([]);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await cachedFetch<{
          success?: boolean;
          delegations?: VestingDelegation[];
          error?: string;
        }>(`/api/query/vesting-delegations?account=${encodeURIComponent(username)}`, {
          staleMs: 15_000,
          maxAgeMs: 120_000,
        });
        if (cancelled || requestId !== requestIdRef.current) return;
        const data = result.data;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDelegations(data.delegations ?? []);
      } catch (err) {
        if (!cancelled && requestId === requestIdRef.current) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [username]);

  const refetch = useCallback(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!username) {
      setDelegations([]);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await cachedFetch<{
          success?: boolean;
          delegations?: VestingDelegation[];
          error?: string;
        }>(`/api/query/vesting-delegations?account=${encodeURIComponent(username)}`, {
          staleMs: 0,
          maxAgeMs: 0,
        });
        if (requestId !== requestIdRef.current) return;
        const data = result.data;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDelegations(data.delegations ?? []);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setError((err as Error).message);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [username]);

  return { delegations, loading, error, refetch };
}

export function useExpiringVestingDelegations(username: string) {
  const [delegations, setDelegations] = useState<ExpiringVestingDelegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) {
      void Promise.resolve().then(() => {
        setDelegations([]);
        setLoading(false);
      });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await cachedFetch<{
          success?: boolean;
          delegations?: ExpiringVestingDelegation[];
          error?: string;
        }>(
          `/api/query/expiring-vesting-delegations?account=${encodeURIComponent(username)}`,
          { staleMs: 15_000, maxAgeMs: 120_000 }
        );
        if (cancelled) return;
        const data = result.data;
        if (data.error) {
          setError(data.error);
          return;
        }
        setDelegations(data.delegations ?? []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  return { delegations, loading, error };
}
