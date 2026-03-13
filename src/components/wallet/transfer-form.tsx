'use client';

import { useState, useTransition } from 'react';
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

interface TransferFormData {
  to: string;
  amount: string;
  memo: string;
}

export function TransferForm() {
  const t = useTranslations('transfer');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);
  const privateKey = usePrivateKey();
  const [isPending, startTransition] = useTransition();

  const [formData, setFormData] = useState<TransferFormData>({
    to: '',
    amount: '',
    memo: '',
  });
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError('');
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
      // Validate recipient
      if (!formData.to.trim()) {
        setError('Please enter a recipient username');
        setIsLoading(false);
        return;
      }

      // Validate amount format (e.g., "1.000 STEEM")
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

      // Format amount for Steem (3 decimal places)
      const amount = `${amountValue.toFixed(3)} STEEM`;

      // Sign transaction
      const signedTx: SignedTransaction = SteemSigner.signTransfer(
        username,
        formData.to.trim(),
        amount,
        formData.memo,
        privateKey
      );

      // Broadcast transaction
      const response = await apiClient.broadcastTransfer(signedTx, username);

      if (!response.success) {
        setError(response.error || t('transferError'));
        setIsLoading(false);
        return;
      }

      // Success - redirect to user's wallet transfers view
      startTransition(() => {
        const encoded = encodeURIComponent(`@${username}`);
        router.push(`/${encoded}/transfers`);
      });
    } catch (err) {
      console.error('Transfer error:', err);
      setError('Failed to process transfer');
      setIsLoading(false);
    }
  };

  return (
    <Card className="mx-auto max-w-md mt-8 shadow-sm">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="to">{t('to')}</Label>
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

          <div className="space-y-2">
            <Label htmlFor="amount">{t('amount')}</Label>
            <Input
              type="number"
              id="amount"
              name="amount"
              value={formData.amount}
              onChange={handleChange}
              required
              step="0.001"
              min="0"
              placeholder="Enter amount (e.g., 1.000)"
              disabled={isLoading || isPending}
            />
            <p className="text-xs text-muted-foreground">
              Amount in STEEM (e.g., 1.000)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="memo">{t('memo')}</Label>
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
              {isLoading || isPending ? tCommon('loading') : t('transferButton')}
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
