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

export function PowerDownForm() {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const { data: account } = useAccountData();

  const [shares, setShares] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isPoweringDown =
    account?.vesting_withdraw_rate && account.vesting_withdraw_rate !== '0.000000 VESTS';

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
      // Validate shares
      const shareValue = parseFloat(shares);
      if (!shares || isNaN(shareValue) || shareValue <= 0) {
        setError('Please enter a valid amount');
        setIsLoading(false);
        return;
      }

      // Format shares
      const vests = `${shareValue.toFixed(6)} VESTS`;

      // Sign transaction
      const signedTx = SteemSigner.signPowerDown(username, vests, privateKey);

      // Broadcast transaction
      const response = await apiClient.broadcastPowerDown(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to power down');
        setIsLoading(false);
        return;
      }

      // Redirect back to user's wallet
      startTransition(() => {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      });
    } catch (err) {
      console.error('Power down error:', err);
      setError('Failed to process power down');
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!username || !privateKey) {
      setError('Not authenticated');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Cancel power down by setting amount to 0
      const vests = '0.000000 VESTS';

      const signedTx = SteemSigner.signPowerDown(username, vests, privateKey);
      const response = await apiClient.broadcastPowerDown(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to cancel power down');
        setIsLoading(false);
        return;
      }

      startTransition(() => {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      });
    } catch (err) {
      console.error('Cancel power down error:', err);
      setError('Failed to cancel power down');
      setIsLoading(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md mt-8 shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">{t('powerDown')}</CardTitle>
      </CardHeader>
      <CardContent>
        {account && (
          <div className="mb-6 rounded-md bg-muted p-4 border border-border">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Current Rate:</p>
                <p className="font-medium text-foreground">
                  {account.vesting_withdraw_rate}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Next Withdrawal:</p>
                <p className="font-medium text-foreground">
                  {account.next_vesting_withdrawal}
                </p>
              </div>
            </div>
            {isPoweringDown && (
              <div className="mt-4">
                <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">
                  Power down is currently active
                </p>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="shares">VESTS to Power Down</Label>
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
            <p className="text-xs text-muted-foreground">
              Use format: 6 decimal places (e.g., 1000000.000000)
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
              <p className="text-sm text-destructive font-medium">{error}</p>
            </div>
          )}

          <div className="flex gap-4 pt-2">
            <Button
              type="submit"
              disabled={isLoading || isPending}
              className="flex-1"
            >
              {isLoading || isPending ? tCommon('loading') : 'Start Power Down'}
            </Button>

            {isPoweringDown && (
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading || isPending}
                className="flex-1"
              >
                Cancel Power Down
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
