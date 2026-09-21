'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { isDegraded, subscribeToDegradation } from '@/lib/cache/degradation-state';

export type ServiceHealthStatus = 'healthy' | 'degraded' | 'outage' | 'unknown';

const POLL_INTERVAL = 60_000;

export function useServiceHealth() {
  const [status, setStatus] = useState<ServiceHealthStatus>('unknown');
  // Per-response signal: cachedFetch writes the X-Degraded header of every
  // network response into degradation-state. Subscribing here lets the
  // banner react to a degraded query response within its normal render
  // cycle instead of waiting up to POLL_INTERVAL for the next poll.
  const [responseDegraded, setResponseDegraded] = useState(() => isDegraded());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      const data = (await res.json()) as { status?: string };
      if (data.status === 'healthy') {
        setStatus('healthy');
      } else if (data.status === 'degraded') {
        setStatus('degraded');
      } else {
        setStatus('outage');
      }
    } catch {
      setStatus('outage');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToDegradation(setResponseDegraded);
    return unsubscribe;
  }, []);

  useEffect(() => {
    (async () => { await check(); })();

    intervalRef.current = setInterval(() => { void check(); }, POLL_INTERVAL);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void check();
        if (!intervalRef.current) {
          intervalRef.current = setInterval(check, POLL_INTERVAL);
        }
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [check]);

  // Merge the two signals with explicit precedence:
  // - outage (poll could not reach /api/health at all) is the strongest signal;
  // - otherwise ANY recently observed degraded response shows 'degraded', even
  //   when the last poll said healthy — the poll is the 60s backstop for pages
  //   with no queries, the per-response flag is the fast path;
  // - recovery requires BOTH signals healthy: cachedFetch resets the flag on
  //   the next non-degraded response, and the poll must say healthy too.
  if (responseDegraded) {
    return status === 'outage' ? 'outage' : 'degraded';
  }
  return status;
}
