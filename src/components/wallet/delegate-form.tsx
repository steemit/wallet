'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useSessionSigning } from '@/hooks/use-session-signing';
import { useGlobalProps } from '@/hooks/use-global-props';
import { LoginForm } from '@/components/auth/login-form';
import { apiClient } from '@/lib/steem/client';
import type { Operation } from '@/lib/steem/types';
import { steemPowerToVestsAsset } from '@/lib/wallet/vest-steem';
import { Button } from '@/components/ui/button';
import {
  ModalFormActions,
  modalFormActionButtonClassName,
} from '@/components/ui/modal-form-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  // Unified signing entry (A6-T3a): privateKey sessions sign through the
  // facade's legacy backend exactly as before; vault identity sessions get
  // the per-key password dialog. `signing.dialog` mounts it.
  const signing = useSessionSigning();
  const [isPending, startTransition] = useTransition();
  const { globalProps, loading: globalPropsLoading } = useGlobalProps();

  const [delegatee, setDelegatee] = useState('');
  const [shares, setShares] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!username) {
      setError(tDelegations('notAuthenticated'));
      setIsLoading(false);
      return;
    }

    if (!globalProps) {
      setError(tDelegations('loadError'));
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

      // Build the exact operation tuple SteemSigner.signDelegate used to
      // build internally — the signing itself now goes through the unified
      // session signing entry (A6-T3a).
      const operations: Operation[] = [
        [
          'delegate_vesting_shares',
          {
            delegator: username,
            delegatee: delegatee.trim(),
            vesting_shares: vests,
          },
        ],
      ];

      // delegate_vesting_shares is an active-class operation. privateKey
      // sessions sign through the facade's legacy backend (active key, owner
      // fallback — the useActiveSigningKey rule); vault sessions get the
      // per-key password dialog.
      const outcome = await signing.sign({
        operations,
        accountName: username,
        role: 'active',
      });

      if (outcome.status === 'cancelled') {
        // User aborted the vault dialog — back to the form, no error.
        setIsLoading(false);
        return;
      }
      if (outcome.status === 'needsClassicReauth') {
        // privateKey session without an active/owner key: the classic
        // re-auth dialog (the same gate the wallet modal shows up front).
        setIsLoading(false);
        setReauthOpen(true);
        return;
      }
      if (outcome.status === 'error') {
        setIsLoading(false);
        setError(tDelegations('delegateError'));
        return;
      }

      const response = await apiClient.broadcastDelegate(
        outcome.result.signedTx,
        username
      );

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

  const reauthDialog = (
    <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
      <DialogContent className="z-[60] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reauthTitle')}</DialogTitle>
          <DialogDescription>{t('reauthDescription')}</DialogDescription>
        </DialogHeader>
        <LoginForm
          embedded
          fixedUsername={username ?? ''}
          requiredAuthTypes={['active']}
          onLoginSuccess={() => setReauthOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{t('delegations')}</h2>
        {formInner}
        {reauthDialog}
        {signing.dialog}
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
      {reauthDialog}
      {signing.dialog}
    </div>
  );
}
