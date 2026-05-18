'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export type ServiceHealthStatus = 'healthy' | 'degraded' | 'outage' | 'unknown';

const POLL_INTERVAL = 30_000;

export function useServiceHealth() {
  const [status, setStatus] = useState<ServiceHealthStatus>('unknown');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) {
        setStatus('outage');
        return;
      }
      const data = await res.json();
      if (data.status === 'healthy') {
        setStatus('healthy');
      } else {
        setStatus('degraded');
      }
    } catch {
      setStatus('outage');
    }
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

  return status;
}
