'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WalletTransferType } from '@/lib/wallet/wallet-modal-search-params';

export type TransferFormVariant = 'page' | 'dialog';

export interface TransferFormProps {
  variant?: TransferFormVariant;
  /** Initial asset from URL / balance row (STEEM, SBD, or VESTS for power-up entry). */
  initialAsset?: 'STEEM' | 'SBD' | 'VESTS';
  /** transfer = to another account; savings / savings_withdraw / power_up = self operations. */
  initialTransferType?: WalletTransferType;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TransferForm({
  variant = 'page',
  initialAsset = 'STEEM',
  initialTransferType = 'transfer',
  onSuccess,
  onCancel,
}: TransferFormProps) {
  const t = useTranslations('transfer');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const [transferType, setTransferType] = useState<WalletTransferType>(initialTransferType);
  const [asset, setAsset] = useState<'STEEM' | 'SBD'>(initialAsset === 'SBD' ? 'SBD' : 'STEEM');
  const [formData, setFormData] = useState({ to: '', amount: '', memo: '' });
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setTransferType(initialTransferType);
    setAsset(initialAsset === 'SBD' ? 'SBD' : 'STEEM');
  }, [initialAsset, initialTransferType]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const amountSuffix =
    transferType === 'power_up' ? 'STEEM' : asset === 'SBD' ? 'SBD' : 'STEEM';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!username || !privateKey) {
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

    try {
      const amountMatch = formData.amount.match(/^([\d.]+)\s*$/);
      if (!amountMatch || !amountMatch[1]) {
        setError('Please enter a valid amount');
        setIsLoading(false);
        return;
      }
      const amountValue = parseFloat(amountMatch[1]);
      if (amountValue <= 0 || isNaN(amountValue)) {
        setError('Amount must be greater than 0');
        setIsLoading(false);
        return;
      }

      const amountStr = `${amountValue.toFixed(3)} ${amountSuffix}`;
      let signedTx: SignedTransaction;

      if (transferType === 'transfer') {
        if (!formData.to.trim()) {
          setError('Please enter a recipient username');
          setIsLoading(false);
          return;
        }
        signedTx = SteemSigner.signTransfer(
          username,
          formData.to.trim(),
          amountStr,
          formData.memo,
          privateKey
        );
      } else if (transferType === 'savings') {
        signedTx = SteemSigner.signTransferToSavings(
          username,
          username,
          amountStr,
          formData.memo,
          privateKey
        );
      } else if (transferType === 'savings_withdraw') {
        const requestId = Date.now() >>> 0;
        signedTx = SteemSigner.signTransferFromSavings(
          username,
          username,
          amountStr,
          formData.memo,
          requestId,
          privateKey
        );
      } else if (transferType === 'power_up') {
        signedTx = SteemSigner.signTransferToVesting(
          username,
          username,
          amountStr,
          privateKey
        );
      } else {
        setError('Unsupported operation');
        setIsLoading(false);
        return;
      }

      const response = await apiClient.broadcastTransfer(signedTx, username);

      if (!response.success) {
        setError(response.error || t('transferError'));
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      startTransition(() => {
        if (onSuccess) {
          onSuccess();
        } else {
          const encoded = encodeURIComponent(`@${username}`);
          router.push(`/${encoded}/transfers`);
        }
      });
    } catch (err) {
      console.error('Transfer error:', err);
      setError('Failed to process transfer');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    else router.back();
  };

  const showRecipient = transferType === 'transfer';
  const showMemo =
    transferType === 'transfer' ||
    transferType === 'savings' ||
    transferType === 'savings_withdraw';
  const titleKey =
    transferType === 'savings'
      ? 'Transfer to savings'
      : transferType === 'savings_withdraw'
        ? 'Withdraw from savings'
        : transferType === 'power_up'
          ? 'Power up'
          : t('title');

  const formBody = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {variant === 'page' && transferType === 'transfer' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <Label>Asset</Label>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={asset}
              onChange={(e) => setAsset(e.target.value as 'STEEM' | 'SBD')}
              disabled={isLoading || isPending}
            >
              <option value="STEEM">STEEM</option>
              <option value="SBD">SBD</option>
            </select>
          </div>
        </div>
      )}

      {showRecipient && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="to" className="text-base">
            {t('to')}
          </Label>
          <Input
            type="text"
            id="to"
            name="to"
            value={formData.to}
            onChange={handleChange}
            required
            placeholder="Enter recipient username"
            disabled={isLoading || isPending}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="amount" className="text-base">
          {t('amount')}
        </Label>
        <Input
          type="number"
          id="amount"
          name="amount"
          value={formData.amount}
          onChange={handleChange}
          required
          step="0.001"
          min="0"
          placeholder={`e.g. 1.000 ${amountSuffix}`}
          disabled={isLoading || isPending}
        />
        <p className="text-muted-foreground text-sm">Amount in {amountSuffix}</p>
      </div>

      {showMemo && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="memo" className="text-base">
            {t('memo')}
          </Label>
          <Input
            type="text"
            id="memo"
            name="memo"
            value={formData.memo}
            onChange={handleChange}
            placeholder="Optional memo (max 2048 bytes)"
            maxLength={2048}
            disabled={isLoading || isPending}
          />
        </div>
      )}

      {error && (
        <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="flex gap-4 pt-2">
        <Button type="submit" disabled={isLoading || isPending} className="flex-1">
          {isLoading || isPending ? tCommon('loading') : t('transferButton')}
        </Button>
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isLoading || isPending}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{titleKey}</h2>
        {formBody}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{titleKey}</CardTitle>
        </CardHeader>
        <CardContent>{formBody}</CardContent>
      </Card>
    </div>
  );
}
