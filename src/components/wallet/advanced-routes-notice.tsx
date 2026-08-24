'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/steem/client';

/**
 * Legacy parity (UserWallet.jsx advancedRoutesNotification): when the account
 * has custom power-down withdraw routes configured, show a reminder to
 * reconfirm them in Advanced Routes.
 */
export function AdvancedRoutesNotice({
  username,
  isMyAccount,
  refreshNonce,
}: {
  username: string;
  isMyAccount: boolean;
  refreshNonce?: number;
}) {
  const t = useTranslations('wallet');
  const [routeCount, setRouteCount] = useState(0);

  useEffect(() => {
    if (!username || !isMyAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.getWithdrawRoutes(username);
        if (!cancelled) setRouteCount(res.routes?.length ?? 0);
      } catch {
        /* notice is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, isMyAccount, refreshNonce]);

  if (!isMyAccount || routeCount === 0) return null;

  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950/40">
      <p className="text-sm text-emerald-900 dark:text-emerald-200">
        {t('advancedRoutesNotice')}
      </p>
    </div>
  );
}
