'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type PowerDownFormVariant = 'page' | 'dialog';

export interface PowerDownFormProps {
  variant?: PowerDownFormVariant;
  onSuccess?: () => void;
}

export function PowerDownForm({ variant = 'page', onSuccess }: PowerDownFormProps) {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const { data: account, refetch } = useAccountData();

  const [shares, setShares] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isPoweringDown =
    account?.vesting_withdraw_rate && account.vesting_withdraw_rate !== '0.000000 VESTS';

  const finishSuccess = () => {
    setIsLoading(false);
    void refetch();
    startTransition(() => {
      if (onSuccess) onSuccess();
      else {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      }
    });
  };

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
      const shareValue = parseFloat(shares);
      if (!shares || isNaN(shareValue) || shareValue <= 0) {
        setError('Please enter a valid amount');
        setIsLoading(false);
        return;
      }

      const vests = `${shareValue.toFixed(6)} VESTS`;
      const signedTx = SteemSigner.signPowerDown(username, vests, privateKey);
      const response = await apiClient.broadcastPowerDown(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to power down');
        setIsLoading(false);
        return;
      }

      finishSuccess();
    } catch (err) {
      console.error('Power down error:', err);
      setError('Failed to process power down');
      setIsLoading(false);
    }
  };

  const handleCancelPowerDown = async () => {
    if (!username || !privateKey) {
      setError('Not authenticated');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const vests = '0.000000 VESTS';
      const signedTx = SteemSigner.signPowerDown(username, vests, privateKey);
      const response = await apiClient.broadcastPowerDown(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to cancel power down');
        setIsLoading(false);
        return;
      }

      finishSuccess();
    } catch (err) {
      console.error('Cancel power down error:', err);
      setError('Failed to cancel power down');
      setIsLoading(false);
    }
  };

  const summary = account && (
    <div className="border-border bg-muted mb-6 rounded-md border p-4">
      <div className="grid grid-cols-2 gap-4 text-base">
        <div>
          <p className="text-muted-foreground">Current Rate:</p>
          <p className="text-foreground font-medium">{account.vesting_withdraw_rate}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Next Withdrawal:</p>
          <p className="text-foreground font-medium">{account.next_vesting_withdrawal}</p>
        </div>
      </div>
      {isPoweringDown && (
        <div className="mt-4">
          <p className="text-foreground text-base font-medium">Power down is currently active</p>
        </div>
      )}
    </div>
  );

  const formInner = (
    <>
      {summary}
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="shares" className="text-base">
            VESTS to Power Down
          </Label>
          <Input
            type="number"
            id="shares"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            step="0.000001"
            min="0"
            required={!isPoweringDown}
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

        <div className="flex gap-4 pt-2">
          <Button type="submit" disabled={isLoading || isPending} className="flex-1">
            {isLoading || isPending ? tCommon('loading') : 'Start Power Down'}
          </Button>
          {isPoweringDown && (
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelPowerDown}
              disabled={isLoading || isPending}
              className="flex-1"
            >
              Cancel Power Down
            </Button>
          )}
        </div>
      </form>
    </>
  );

  if (variant === 'dialog') {
    return (
      <div className="px-1 py-1">
        <h2 className="mb-4 text-lg font-semibold">{t('powerDown')}</h2>
        {formInner}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg px-4">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{t('powerDown')}</CardTitle>
        </CardHeader>
        <CardContent>{formInner}</CardContent>
      </Card>
    </div>
  );
}
