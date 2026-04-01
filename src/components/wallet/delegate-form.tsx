'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
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

export type DelegateFormVariant = 'page' | 'dialog';

export interface DelegateFormProps {
  variant?: DelegateFormVariant;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DelegateForm({
  variant = 'page',
  onSuccess,
  onCancel,
}: DelegateFormProps) {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending, startTransition] = useTransition();

  const [delegatee, setDelegatee] = useState('');
  const [shares, setShares] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!username || !signingKey) {
      setError('Not authenticated');
      setIsLoading(false);
      return;
    }

    try {
      if (!delegatee.trim()) {
        setError('Please enter a delegatee username');
        setIsLoading(false);
        return;
      }

      const shareValue = parseFloat(shares);
      if (!shares || isNaN(shareValue) || shareValue <= 0) {
        setError('Please enter a valid amount');
        setIsLoading(false);
        return;
      }

      const vests = `${shareValue.toFixed(6)} VESTS`;
      const signedTx = SteemSigner.signDelegate(username, delegatee.trim(), vests, signingKey);
      const response = await apiClient.broadcastDelegate(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to delegate');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      startTransition(() => {
        if (onSuccess) onSuccess();
        else {
          router.push(transfersPathForUsername(username));
        }
      });
    } catch (err) {
      console.error('Delegate error:', err);
      setError('Failed to process delegation');
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    else router.back();
  };

  const formInner = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="delegatee" className="text-base">
          Delegatee Username
        </Label>
        <Input
          type="text"
          id="delegatee"
          value={delegatee}
          onChange={(e) => setDelegatee(e.target.value)}
          required
          placeholder="Enter username to delegate to"
          disabled={isLoading || isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="shares" className="text-base">
          VESTS to Delegate
        </Label>
        <Input
          type="number"
          id="shares"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          step="0.000001"
          min="0"
          required
          placeholder="Enter VESTS amount"
          disabled={isLoading || isPending}
        />
        <p className="text-muted-foreground text-sm">Use format: 6 decimal places (e.g., 1000000.000000)</p>
      </div>

      {error && (
        <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm font-medium">{error}</p>
        </div>
      )}

      <ModalFormActions className="pt-4">
        <Button
          type="submit"
          disabled={isLoading || isPending}
          className={modalFormActionButtonClassName}
        >
          {isLoading || isPending ? tCommon('loading') : 'Delegate'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={isLoading || isPending}
          className={modalFormActionButtonClassName}
        >
          {tCommon('cancel')}
        </Button>
      </ModalFormActions>
    </form>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{t('delegations')}</h2>
        {formInner}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{t('delegations')}</CardTitle>
        </CardHeader>
        <CardContent>{formInner}</CardContent>
      </Card>
    </div>
  );
}
