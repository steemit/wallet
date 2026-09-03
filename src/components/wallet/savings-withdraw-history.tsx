'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { cachedFetch } from '@/lib/cache/client-fetch';
import { clientCache } from '@/lib/cache/client-cache';
import { formatTimeUntil } from '@/lib/wallet/format-time-ago';
import type { PendingSavingsWithdrawal } from '@/hooks/use-wallet-estimated-value';
import { userActionRecord } from '@/lib/analytics/overseer';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Legacy parity (elements/SavingsWithdrawHistory.jsx): list the account's
 * pending savings withdrawals (3-day waiting period) with a cancel action
 * (cancel_transfer_from_savings, active authority).
 */
export function SavingsWithdrawHistory({
  username,
  onChanged,
}: {
  username: string;
  onChanged?: () => void;
}) {
  const t = useTranslations('wallet.savingsWithdrawals');
  const signingKey = useActiveSigningKey();

  const [withdrawals, setWithdrawals] = useState<PendingSavingsWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<PendingSavingsWithdrawal | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const extrasUrl = `/api/query/wallet-estimate-extras?username=${encodeURIComponent(username)}&includeOpenOrders=true`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await cachedFetch<{
        success?: boolean;
        savingsWithdrawals?: PendingSavingsWithdrawal[];
      }>(extrasUrl, { staleMs: 30_000, maxAgeMs: 120_000 });
      if (data.success) setWithdrawals(data.savingsWithdrawals ?? []);
    } catch (e) {
      console.warn('Error loading savings withdrawals:', e);
    } finally {
      setLoading(false);
    }
  }, [extrasUrl]);

  useEffect(() => {
    if (!username) return;
    // Defer past the effect body: load() sets state synchronously at its top,
    // which react-hooks/set-state-in-effect forbids inside an effect.
    void Promise.resolve().then(load);
  }, [username, load]);

  const handleCancel = async () => {
    if (!cancelTarget || !signingKey || !username) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const signedTx = await SteemSigner.signCancelTransferFromSavings(
        username,
        cancelTarget.requestId,
        signingKey
      );
      const res = await apiClient.broadcastCancelTransferFromSavings(signedTx, username);
      if (!res.success) {
        setCancelError(res.error || t('cancelFailed'));
        setCancelling(false);
        return;
      }
      userActionRecord('cancel_transfer_from_savings', { username });
      setCancelTarget(null);
      setCancelling(false);
      clientCache.invalidate(extrasUrl);
      await load();
      onChanged?.();
    } catch (err) {
      setCancelling(false);
      setCancelError(err instanceof Error ? err.message : t('cancelFailed'));
    }
  };

  if (loading) {
    return (
      <div className="mt-4">
        <Skeleton className="h-6 w-48" />
      </div>
    );
  }
  if (withdrawals.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="mb-2 px-4 text-lg font-medium">{t('title')}</h4>
      <ul className="space-y-1 px-4 text-sm">
        {withdrawals.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {t('withdrawTo', { amount: w.amount, to: w.to })}
            </span>
            <button
              type="button"
              className="text-destructive cursor-pointer hover:underline"
              onClick={() => {
                setCancelError(null);
                setCancelTarget(w);
              }}
            >
              ({t('cancel')})
            </button>
            <span className="text-muted-foreground">
              — {t('completes', { time: formatTimeUntil(w.complete) })}
            </span>
          </li>
        ))}
      </ul>

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('cancelDescription', { amount: cancelTarget?.amount ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelError && (
            <p className="text-destructive px-6 text-sm">{cancelError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{t('back')}</AlertDialogCancel>
            <Button onClick={handleCancel} disabled={cancelling || !signingKey}>
              {cancelling ? t('cancelling') : t('cancelConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
