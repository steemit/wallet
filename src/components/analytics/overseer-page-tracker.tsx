'use client';

import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { usePathname } from '@/i18n/routing';
import type { RootState } from '@/lib/store';
import { recordRouteTag } from '@/lib/analytics/overseer';
import { routeTagFromPathname } from '@/lib/analytics/overseer-payload';

/**
 * Legacy parity: each page dispatched `setRouteTag`, which saga'd into
 * `overseer.collect` measurement `route`. One listener covers App Router navigations.
 */
export function OverseerPageTracker() {
  const pathname = usePathname();
  const isLogin = useSelector((state: RootState) => state.auth.isAuthenticated);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const key = `${pathname}|${isLogin ? '1' : '0'}`;
    if (last.current === key) return;
    last.current = key;
    const mapped = routeTagFromPathname(pathname);
    recordRouteTag(mapped.tag, mapped.params, isLogin);
  }, [pathname, isLogin]);

  return null;
}
