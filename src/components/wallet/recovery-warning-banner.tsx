'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { cachedFetch } from '@/lib/cache/client-fetch';
import { clientCache } from '@/lib/cache/client-cache';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DAYS_TO_HIDE = 5;

interface PendingRecoveryChange {
  accountToRecover: string;
  currentRecoveryAccount: string;
  pendingRecoveryAccount: string;
  daysLeft: number;
}

/**
 * Legacy parity (UserWallet.jsx recoveryWarningBox + ChangeRecoveryAccount):
 * warn the owner when a change_recovery_account request is pending, allow
 * dismissing it for DAYS_TO_HIDE days (localStorage), and let the owner
 * broadcast a counter change_recovery_account operation (owner key required).
 */
export function RecoveryWarningBanner({
  username,
  isMyAccount,
  onChanged,
}: {
  username: string;
  isMyAccount: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations('wallet.recoveryWarning');
  const [pending, setPending] = useState<PendingRecoveryChange | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const storageKey = `button_click_${username}`;

  useEffect(() => {
    if (!username || !isMyAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await cachedFetch<{
          success?: boolean;
          accounts?: Array<{
            name?: string;
            recovery_account?: string;
            account_recovery?: {
              account_to_recover: string;
              recovery_account: string;
              effective_on: string;
            } | null;
          }>;
        }>(`/api/query/accounts?names=${encodeURIComponent(username)}`, {
          staleMs: 30_000,
          maxAgeMs: 120_000,
        });
        if (cancelled || !data.success) return;
        const acc = data.accounts?.[0];
        const recoveryInfo = acc?.account_recovery;
        if (!acc || !recoveryInfo) return;
        const rawTs = recoveryInfo.effective_on;
        const effectiveDate = new Date(rawTs.endsWith('Z') ? rawTs : `${rawTs}Z`);
        const daysLeft = Math.ceil(
          (effectiveDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (daysLeft <= 0) return;
        setPending({
          accountToRecover: recoveryInfo.account_to_recover,
          currentRecoveryAccount: acc.recovery_account ?? '',
          pendingRecoveryAccount: recoveryInfo.recovery_account,
          daysLeft,
        });

        // Legacy dismiss behavior: hidden for DAYS_TO_HIDE days after dismiss;
        // reset if the pending recovery account changed.
        try {
          const stored = localStorage.getItem(storageKey);
          if (stored) {
            const parsed = JSON.parse(stored) as {
              clicked?: boolean;
              timestamp?: string;
              recovery_account?: string;
            };
            if (parsed.recovery_account !== recoveryInfo.recovery_account) {
              localStorage.removeItem(storageKey);
              return;
            }
            if (parsed.clicked && parsed.timestamp) {
              const diffDays =
                (Date.now() - new Date(parsed.timestamp).getTime()) /
                (1000 * 60 * 60 * 24);
              if (diffDays <= DAYS_TO_HIDE) {
                setDismissed(true);
              } else {
                localStorage.removeItem(storageKey);
              }
            }
          }
        } catch (e) {
          console.warn('Error parsing recovery dismiss state:', e);
        }
      } catch (e) {
        console.warn('Error checking pending recovery change:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, isMyAccount, storageKey]);

  const handleDismiss = useCallback(() => {
    if (!pending) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          clicked: true,
          timestamp: new Date().toISOString(),
          recovery_account: pending.pendingRecoveryAccount,
        })
      );
    } catch {
      /* localStorage unavailable — hide for this session only */
    }
    setDismissed(true);
  }, [pending, storageKey]);

  if (!isMyAccount || !pending || dismissed) return null;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        {t('warning', {
          days: pending.daysLeft,
          dayLabel: pending.daysLeft === 1 ? t('day') : t('days'),
          recoveryAccount: pending.pendingRecoveryAccount,
        })}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          {t('takeAction')}
        </Button>
        <Button size="sm" variant="outline" onClick={handleDismiss}>
          {t('dismiss')}
        </Button>
      </div>

      <ChangeRecoveryAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pending={pending}
        onSuccess={() => {
          setDialogOpen(false);
          setPending(null);
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
          clientCache.invalidate(
            `/api/query/accounts?names=${encodeURIComponent(username)}`
          );
          onChanged?.();
        }}
      />
    </div>
  );
}

function ChangeRecoveryAccountDialog({
  open,
  onOpenChange,
  pending,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingRecoveryChange;
  onSuccess: () => void;
}) {
  const t = useTranslations('wallet.changeRecoveryAccount');
  const ownerKey = useSelector((state: RootState) => state.auth.ownerKey);
  const [newAccount, setNewAccount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const target = newAccount.trim().replace(/^@/, '').toLowerCase();
    if (!target) {
      setError(t('required'));
      return;
    }
    if (!ownerKey) {
      setError(t('ownerKeyRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const signedTx = await SteemSigner.signChangeRecoveryAccount(
        pending.accountToRecover,
        target,
        ownerKey
      );
      const res = await apiClient.broadcastChangeRecoveryAccount(
        signedTx,
        pending.accountToRecover
      );
      if (!res.success) {
        setError(res.error || t('failed'));
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onSuccess();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : t('failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('faqHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label>{t('currentAccount')}</Label>
            <Input value={pending.accountToRecover} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('currentRecoveryAccount')}</Label>
            <Input value={pending.currentRecoveryAccount} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>{t('pendingRecoveryAccount')}</Label>
            <Input value={pending.pendingRecoveryAccount} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-recovery-account">{t('newAccount')}</Label>
            <Input
              id="new-recovery-account"
              value={newAccount}
              onChange={(e) => {
                setNewAccount(e.target.value);
                setError('');
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={submitting}
            />
          </div>
          {!ownerKey && (
            <p className="text-muted-foreground text-sm">{t('ownerKeyRequired')}</p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !ownerKey}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
