'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';
import type { SteemAccount } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

export type ConvertSbdFormVariant = 'dialog' | 'page';

export interface ConvertSbdFormProps {
  variant?: ConvertSbdFormVariant;
  accountUsername: string;
  isMyAccount: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
}

function parseAssetAmount(assetStr: string | undefined): number {
  if (!assetStr) return 0;
  const m = assetStr.match(/^([\d.]+)/);
  return m && m[1] ? parseFloat(m[1]) : 0;
}

export function ConvertSbdForm({
  variant = 'dialog',
  accountUsername,
  isMyAccount,
  onSuccess,
  onCancel,
}: ConvertSbdFormProps) {
  const t = useTranslations('wallet.convertSbd');
  const tCommon = useTranslations('common');
  const loggedIn = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();

  const [amount, setAmount] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [marketRate, setMarketRate] = useState<number | null>(null);
  const [sbdMax, setSbdMax] = useState(0);
  const [loadingPrice, setLoadingPrice] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPrice(true);
      try {
        const res = await apiClient.getMedianHistoryPrice();
        if (cancelled) return;
        if (res.error || !res.base || !res.quote) {
          setMarketRate(null);
          return;
        }
        const baseSbd = parseAssetAmount(res.base);
        const quoteSteem = parseAssetAmount(res.quote);
        if (baseSbd > 0 && quoteSteem > 0) {
          setMarketRate(quoteSteem / baseSbd);
        }
      } catch {
        if (!cancelled) setMarketRate(null);
      } finally {
        if (!cancelled) setLoadingPrice(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountUsername) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.getAccounts([accountUsername]);
        if (cancelled || res.error || !res.accounts?.[0]) return;
        const acc = res.accounts[0] as SteemAccount;
        setSbdMax(parseAssetAmount(acc.sbd_balance));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountUsername]);

  const amountNum = parseFloat(amount) || 0;
  const projectedSteem =
    marketRate !== null && amountNum > 0 ? (amountNum * marketRate).toFixed(3) : '0.000';

  const canSubmit =
    isMyAccount &&
    !!loggedIn &&
    loggedIn === accountUsername &&
    !!signingKey &&
    amountNum > 0 &&
    amountNum <= sbdMax + 1e-9 &&
    acknowledged &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!signingKey || !loggedIn || loggedIn !== accountUsername) {
      setError(t('mustBeAccountOwner'));
      return;
    }
    if (!acknowledged) {
      setError(t('mustAcknowledge'));
      return;
    }
    if (amountNum <= 0 || amountNum > sbdMax) {
      setError(t('invalidAmount'));
      return;
    }
    setSubmitting(true);
    try {
      const amountStr = `${amountNum.toFixed(3)} SBD`;
      const requestid = Math.floor(Date.now() / 1000);
      const signedTx: SignedTransaction = await SteemSigner.signConvert(
        accountUsername,
        requestid,
        amountStr,
        signingKey
      );
      const res = await apiClient.broadcastConvert(signedTx, loggedIn);
      if (!res.success) {
        setError(res.error || t('broadcastFailed'));
        setSubmitting(false);
        return;
      }
      onSuccess?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const fillMax = () => {
    if (sbdMax > 0) setAmount(sbdMax.toFixed(3));
  };

  const inner = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-muted-foreground text-sm">{t('intro')}</p>
      <p className="text-muted-foreground text-sm">{t('delayNotice')}</p>

      {loadingPrice && (
        <p className="text-muted-foreground text-xs">{tCommon('loading')}</p>
      )}
      {!loadingPrice && marketRate === null && (
        <p className="text-amber-600 text-xs">{t('priceUnavailable')}</p>
      )}

      <div className="space-y-1">
        <Label htmlFor="cv-amt">{t('amountLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id="cv-amt"
            type="number"
            step="0.001"
            min={0}
            max={sbdMax}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting || !isMyAccount}
          />
          <Button type="button" variant="outline" size="sm" onClick={fillMax} disabled={submitting || sbdMax <= 0}>
            {t('useMax')}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t('balance', { balance: sbdMax.toFixed(3) })}
        </p>
      </div>

      <div className="space-y-1">
        <Label>{t('projectedSteem')}</Label>
        <Input readOnly value={projectedSteem} className="bg-muted" />
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="cv-ack"
          checked={acknowledged}
          onCheckedChange={(c) => setAcknowledged(c === true)}
          disabled={submitting}
        />
        <Label htmlFor="cv-ack" className="text-sm font-normal leading-snug">
          {t('acknowledge')}
        </Label>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <ModalFormActions className="pt-4" columns={onCancel ? 2 : 1}>
        <Button type="submit" disabled={!canSubmit} className={modalFormActionButtonClassName}>
          {submitting ? tCommon('loading') : t('convertButton')}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className={modalFormActionButtonClassName}
          >
            {tCommon('cancel')}
          </Button>
        )}
      </ModalFormActions>
    </form>
  );

  if (variant === 'dialog') {
    return <div className="px-0 py-0">{inner}</div>;
  }

  return <div className="mx-auto max-w-lg px-4 py-4">{inner}</div>;
}
