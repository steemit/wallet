'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';

export type PowerUpFormVariant = 'page' | 'dialog';

export interface PowerUpFormProps {
  variant?: PowerUpFormVariant;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const STEEM_ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;

function parseSteemBalance(assetStr: string | undefined): number {
  if (!assetStr) return 0;
  const m = assetStr.match(/^([\d.]+)/);
  return m && m[1] ? parseFloat(m[1]) : 0;
}

function countDecimals(value: string): number {
  const parts = value.split('.');
  return parts.length > 1 && parts[1] ? parts[1].length : 0;
}

export function PowerUpForm({
  variant = 'page',
  onSuccess,
  onCancel,
}: PowerUpFormProps) {
  const t = useTranslations('powerUp');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending, startTransition] = useTransition();
  const { data: account, refetch } = useAccountData();

  const [advanced, setAdvanced] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const steemBalance = parseSteemBalance(account?.balance);

  const fillMaxBalance = () => {
    if (steemBalance > 0) {
      setAmount(steemBalance.toFixed(3));
      setError('');
    }
  };

  const toggleAdvanced = (e: React.MouseEvent) => {
    e.preventDefault();
    if (username) setTo(username);
    setAdvanced((prev) => !prev);
    setError('');
  };

  const finishSuccess = () => {
    setIsLoading(false);
    void refetch();
    startTransition(() => {
      if (onSuccess) onSuccess();
      else if (username) {
        router.push(transfersPathForUsername(username));
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!username || !signingKey) {
      setError(t('notAuthenticated'));
      setIsLoading(false);
      return;
    }

    const recipientName = advanced ? to.trim().toLowerCase() : username;

    if (!recipientName) {
      setError(t('invalidRecipient'));
      setIsLoading(false);
      return;
    }

    if (!STEEM_ACCOUNT_RE.test(recipientName)) {
      setError(t('invalidRecipient'));
      setIsLoading(false);
      return;
    }

    const amountMatch = amount.match(/^([\d.]+)$/);
    if (!amountMatch || !amountMatch[1]) {
      setError(t('invalidAmount'));
      setIsLoading(false);
      return;
    }

    const amountValue = parseFloat(amountMatch[1]);
    if (amountValue <= 0 || isNaN(amountValue)) {
      setError(t('amountMustBePositive'));
      setIsLoading(false);
      return;
    }

    if (countDecimals(amountMatch[1]) > 3) {
      setError(t('precisionError'));
      setIsLoading(false);
      return;
    }

    if (amountValue > steemBalance + 1e-9) {
      setError(t('insufficientFunds'));
      setIsLoading(false);
      return;
    }

    try {
      const amountStr = `${amountValue.toFixed(3)} STEEM`;
      const signedTx = await SteemSigner.signTransferToVesting(
        username,
        recipientName,
        amountStr,
        signingKey
      );
      const response = await apiClient.broadcastTransfer(signedTx, username);

      if (!response.success) {
        setError(response.error || t('powerUpError'));
        setIsLoading(false);
        return;
      }

      finishSuccess();
    } catch (err) {
      console.error('Power up error:', err);
      setError(t('powerUpError'));
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    else router.back();
  };

  const infoBlock = (
    <div className="text-muted-foreground mb-6 space-y-2 text-sm">
      <p>{t('influenceToken')}</p>
      <p>{t('nonTransferable')}</p>
    </div>
  );

  const formInner = (
    <>
      {infoBlock}
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="from" className="text-base">
            {t('from')}
          </Label>
          <div className="flex">
            <span className="border-input bg-muted text-muted-foreground inline-flex items-center rounded-l-md border border-r-0 px-3 text-sm">
              @
            </span>
            <Input
              id="from"
              type="text"
              value={username ?? ''}
              disabled
              className="rounded-l-none font-medium"
            />
          </div>
        </div>

        {advanced && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="to" className="text-base">
              {t('to')}
            </Label>
            <Input
              id="to"
              type="text"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setError('');
              }}
              placeholder={t('recipientPlaceholder')}
              disabled={isLoading || isPending}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-sm">{t('advancedRecipientHint')}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="amount" className="text-base">
            {t('amount')}
          </Label>
          <div className="flex gap-2">
            <Input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
              required
              step="0.001"
              min="0"
              placeholder={t('amountPlaceholder')}
              disabled={isLoading || isPending}
              className="flex-1"
            />
            <span className="border-input bg-muted text-muted-foreground inline-flex min-w-[7rem] items-center justify-center rounded-md border px-3 text-sm">
              {t('steemPowerAsset')}
            </span>
          </div>
          <button
            type="button"
            onClick={fillMaxBalance}
            disabled={isLoading || isPending || steemBalance <= 0}
            className="text-muted-foreground hover:text-foreground w-fit border-b border-dotted border-current text-sm transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {t('balance', { balance: steemBalance.toFixed(3) })}
          </button>
        </div>

        {error && (
          <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
            <p className="text-destructive text-sm font-medium">{error}</p>
          </div>
        )}

        <ModalFormActions className="pt-4" columns={2}>
          <Button
            type="submit"
            disabled={isLoading || isPending}
            className={modalFormActionButtonClassName}
          >
            {isLoading || isPending ? tCommon('loading') : t('powerUpButton')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={toggleAdvanced}
            disabled={isLoading || isPending}
            className={modalFormActionButtonClassName}
          >
            {advanced ? t('basic') : t('advanced')}
          </Button>
        </ModalFormActions>
        {onCancel && variant === 'page' && (
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading || isPending}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        )}
      </form>
    </>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{t('title')}</h2>
        {formInner}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>{formInner}</CardContent>
      </Card>
    </div>
  );
}
