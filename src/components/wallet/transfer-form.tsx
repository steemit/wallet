'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { SignedTransaction } from '@/lib/steem/types';

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

      // Success - redirect to wallet
      startTransition(() => {
        router.push('/wallet');
      });
    } catch (err) {
      console.error('Transfer error:', err);
      setError('Failed to process transfer');
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-8 shadow dark:bg-gray-800">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
        {t('title')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="to"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('to')}
          </label>
          <input
            type="text"
            id="to"
            name="to"
            value={formData.to}
            onChange={handleChange}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter recipient username"
            disabled={isLoading || isPending}
          />
        </div>

        <div>
          <label
            htmlFor="amount"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('amount')}
          </label>
          <input
            type="number"
            id="amount"
            name="amount"
            value={formData.amount}
            onChange={handleChange}
            required
            step="0.001"
            min="0"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter amount (e.g., 1.000)"
            disabled={isLoading || isPending}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Amount in STEEM (e.g., 1.000)
          </p>
        </div>

        <div>
          <label
            htmlFor="memo"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t('memo')}
          </label>
          <input
            type="text"
            id="memo"
            name="memo"
            value={formData.memo}
            onChange={handleChange}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Optional memo (max 2048 bytes)"
            maxLength={2048}
            disabled={isLoading || isPending}
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={isLoading || isPending}
            className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {isLoading || isPending ? tCommon('loading') : t('transferButton')}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isLoading || isPending}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {tCommon('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
