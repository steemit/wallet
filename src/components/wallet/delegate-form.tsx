'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DelegateForm() {
  const t = useTranslations('wallet');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const [delegatee, setDelegatee] = useState('');
  const [shares, setShares] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      // Validate inputs
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

      // Format vests
      const vests = `${shareValue.toFixed(6)} VESTS`;

      // Sign transaction
      const signedTx = SteemSigner.signDelegate(
        username,
        delegatee.trim(),
        vests,
        privateKey
      );

      // Broadcast
      const response = await apiClient.broadcastDelegate(signedTx, username);

      if (!response.success) {
        setError(response.error || 'Failed to delegate');
        setIsLoading(false);
        return;
      }

      startTransition(() => {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      });
    } catch (err) {
      console.error('Delegate error:', err);
      setError('Failed to process delegation');
      setIsLoading(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md mt-8 shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">{t('delegations')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="delegatee">Delegatee Username</Label>
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

          <div className="space-y-2">
            <Label htmlFor="shares">VESTS to Delegate</Label>
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
              {isLoading || isPending ? tCommon('loading') : 'Delegate'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isLoading || isPending}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
