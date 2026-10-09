'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useActiveSigningKey } from '@/hooks/use-auth';
import { useGlobalProps } from '@/hooks/use-global-props';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { steemPowerToVestsAsset } from '@/lib/wallet/vest-steem';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';
import { userActionRecord } from '@/lib/analytics/overseer';

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
  const tDelegations = useTranslations('delegations');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const signingKey = useActiveSigningKey();
  const [isPending, startTransition] = useTransition();
  const { globalProps, loading: globalPropsLoading } = useGlobalProps();

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

    if (!globalProps) {
      setError('Unable to load chain properties. Please try again.');
      setIsLoading(false);
      return;
    }

    try {
      if (!delegatee.trim()) {
        setError(tDelegations('invalidDelegatee'));
        setIsLoading(false);
        return;
      }

      const shareValue = parseFloat(shares);
      if (!shares || isNaN(shareValue) || shareValue <= 0) {
        setError(tDelegations('invalidAmount'));
        setIsLoading(false);
        return;
      }

      const vests = steemPowerToVestsAsset(shareValue, globalProps);
      const signedTx = await SteemSigner.signDelegate(username, delegatee.trim(), vests, signingKey);
      const response = await apiClient.broadcastDelegate(signedTx, username);

      if (!response.success) {
        setError(response.error || tDelegations('delegateError'));
        setIsLoading(false);
        return;
      }

      userActionRecord('delegate_vesting_shares', {
        transferCoin: 'VESTS',
        amount: shareValue,
        from: username,
        to: delegatee.trim().replace(/^@/, '').toLowerCase(),
      });

      setIsLoading(false);
      startTransition(() => {
        if (onSuccess) onSuccess();
        else {
          router.push(transfersPathForUsername(username));
        }
      });
    } catch (err) {
      console.error('Delegate error:', err);
      setError(tDelegations('delegateError'));
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
          {tDelegations('delegateeUsername')}
        </Label>
        <Input
          type="text"
          id="delegatee"
          value={delegatee}
          onChange={(e) => setDelegatee(e.target.value)}
          required
          placeholder={tDelegations('delegateePlaceholder')}
          disabled={isLoading || isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="shares" className="text-base">
          {tDelegations('spToDelegate')}
        </Label>
        <Input
          type="number"
          id="shares"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          step="0.001"
          min="0"
          required
          placeholder={tDelegations('spPlaceholder')}
          disabled={isLoading || isPending || globalPropsLoading}
        />
        <p className="text-muted-foreground text-sm">{tDelegations('formatHint')}</p>
      </div>

      {error && (
        <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4">
          <p className="text-destructive text-sm font-medium">{error}</p>
        </div>
      )}

      <ModalFormActions className="pt-4">
        <Button
          type="submit"
          disabled={isLoading || isPending || globalPropsLoading || !globalProps}
          className={modalFormActionButtonClassName}
        >
          {isLoading || isPending ? tCommon('loading') : tDelegations('delegateButton')}
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
