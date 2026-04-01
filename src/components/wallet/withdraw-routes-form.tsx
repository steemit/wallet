'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export type WithdrawRoutesFormVariant = 'dialog' | 'page';

export interface WithdrawRouteRow {
  to_account: string;
  percent: number;
  auto_vest: boolean;
}

export interface WithdrawRoutesFormProps {
  variant?: WithdrawRoutesFormVariant;
  /** Account whose routes are shown (URL wallet owner). */
  accountUsername: string;
  /** Only this user can add/remove routes. */
  isMyAccount: boolean;
  /** Refresh balances/activity without closing the modal. */
  onRoutesUpdated?: () => void;
  onCancel?: () => void;
}

export function WithdrawRoutesForm({
  variant = 'dialog',
  accountUsername,
  isMyAccount,
  onRoutesUpdated,
  onCancel,
}: WithdrawRoutesFormProps) {
  const t = useTranslations('wallet.withdrawRoutes');
  const tCommon = useTranslations('common');
  const loggedIn = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();

  const [routes, setRoutes] = useState<WithdrawRouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [proxyAccount, setProxyAccount] = useState('');
  const [percentage, setPercentage] = useState('');
  const [autoVest, setAutoVest] = useState(false);

  const loadRoutes = useCallback(async () => {
    if (!accountUsername) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.getWithdrawRoutes(accountUsername);
      if (res.error) {
        setError(res.error);
        setRoutes([]);
        return;
      }
      setRoutes(res.routes ?? []);
    } catch (e) {
      setError((e as Error).message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [accountUsername]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const totalRoutedChain = routes.reduce((sum, r) => sum + r.percent, 0);
  const remainingDisplay = Math.max(0, 100 - totalRoutedChain / 100);

  const submitRoute = async (toAccount: string, chainPercent: number, vest: boolean) => {
    if (!loggedIn || !signingKey || loggedIn !== accountUsername) {
      setError(t('mustBeAccountOwner'));
      return;
    }
    setBroadcasting(true);
    setError('');
    try {
      const signedTx: SignedTransaction = SteemSigner.signSetWithdrawVestingRoute(
        accountUsername,
        toAccount,
        chainPercent,
        vest,
        signingKey
      );
      const res = await apiClient.broadcastSetWithdrawVestingRoute(signedTx, loggedIn);
      if (!res.success) {
        setError(res.error || t('broadcastFailed'));
        setBroadcasting(false);
        return;
      }
      await loadRoutes();
      setProxyAccount('');
      setPercentage('');
      setAutoVest(false);
      onRoutesUpdated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBroadcasting(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = parseFloat(percentage);
    if (!proxyAccount.trim()) {
      setError(t('enterDestination'));
      return;
    }
    if (isNaN(pct) || pct <= 0 || pct > remainingDisplay + 1e-9) {
      setError(t('invalidPercent', { max: remainingDisplay.toFixed(2) }));
      return;
    }
    const chainPercent = Math.round(pct * 100);
    await submitRoute(proxyAccount.trim().replace(/^@/, ''), chainPercent, autoVest);
  };

  const handleRemove = (toAccount: string) => {
    void submitRoute(toAccount, 0, false);
  };

  const canEdit = isMyAccount && !!loggedIn && loggedIn === accountUsername && !!signingKey;

  const inner = (
    <div className="space-y-4">
      {!canEdit && (
        <p className="text-muted-foreground text-sm">{t('viewOnly')}</p>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">{tCommon('loading')}</p>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('currentRoutes')}</h4>
          {routes.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noRoutes')}</p>
          ) : (
            <ul className="space-y-2">
              {routes.map((r) => (
                <li
                  key={r.to_account}
                  className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm"
                >
                  <div>
                    <span className="font-medium">@{r.to_account}</span>
                    <span className="text-muted-foreground ml-2">
                      {r.percent / 100}% — {r.auto_vest ? t('autoVestOn') : t('autoVestOff')}
                    </span>
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={broadcasting}
                      onClick={() => handleRemove(r.to_account)}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {routes.length > 0 && (
            <div className="bg-muted/50 rounded-md p-2 text-xs">
              <div className="flex justify-between">
                <span>{t('totalRouted')}</span>
                <strong>{totalRoutedChain / 100}%</strong>
              </div>
              <div className="flex justify-between">
                <span>{t('remainingToYou')}</span>
                <strong>{remainingDisplay.toFixed(2)}%</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <form onSubmit={handleAdd} className="space-y-3 border-t border-border pt-4">
          <h4 className="text-sm font-semibold">{t('addRoute')}</h4>
          <div className="space-y-1">
            <Label htmlFor="wr-to">{t('routeTo')}</Label>
            <Input
              id="wr-to"
              value={proxyAccount}
              onChange={(e) => setProxyAccount(e.target.value)}
              placeholder={t('routeToPlaceholder')}
              disabled={broadcasting}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wr-pct">{t('percentLabel', { max: remainingDisplay.toFixed(2) })}</Label>
            <Input
              id="wr-pct"
              type="number"
              min={0}
              max={remainingDisplay}
              step={0.01}
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              disabled={broadcasting || remainingDisplay <= 0}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="wr-av"
              checked={autoVest}
              onCheckedChange={(c) => setAutoVest(c === true)}
              disabled={broadcasting}
            />
            <Label htmlFor="wr-av" className="text-sm font-normal">
              {t('autoVest')}
            </Label>
          </div>
          <p className="text-muted-foreground text-xs">{t('infoBullets')}</p>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <ModalFormActions className="pt-4" columns={onCancel ? 2 : 1}>
            <Button
              type="submit"
              disabled={broadcasting || remainingDisplay <= 0}
              className={modalFormActionButtonClassName}
            >
              {broadcasting ? tCommon('loading') : tCommon('submit')}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={broadcasting}
                className={modalFormActionButtonClassName}
              >
                {tCommon('cancel')}
              </Button>
            )}
          </ModalFormActions>
        </form>
      )}

      {!canEdit && error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );

  if (variant === 'dialog') {
    return <div className="px-0 py-0">{inner}</div>;
  }

  return <div className="mx-auto max-w-lg px-4 py-4">{inner}</div>;
}
