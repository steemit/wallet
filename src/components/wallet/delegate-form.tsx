'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';

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
        router.push('/wallet');
      });
    } catch (err) {
      console.error('Delegate error:', err);
      setError('Failed to process delegation');
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-8 shadow dark:bg-gray-800">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
        {t('delegations')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="delegatee"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Delegatee Username
          </label>
          <input
            type="text"
            id="delegatee"
            value={delegatee}
            onChange={(e) => setDelegatee(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter username to delegate to"
            disabled={isLoading || isPending}
          />
        </div>

        <div>
          <label
            htmlFor="shares"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            VESTS to Delegate
          </label>
          <input
            type="number"
            id="shares"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            step="0.000001"
            min="0"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            placeholder="Enter VESTS amount"
            disabled={isLoading || isPending}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Use format: 6 decimal places (e.g., 1000000.000000)
          </p>
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
            {isLoading || isPending ? tCommon('loading') : 'Delegate'}
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
