'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { usePrivateKey } from '@/hooks/use-auth';
import { useAccountData } from '@/hooks/use-account-data';
import { SteemSigner, apiClient } from '@/lib/steem/client';

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

      // Redirect back to wallet
      startTransition(() => {
        router.push('/wallet');
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
        router.push('/wallet');
      });
    } catch (err) {
      console.error('Cancel power down error:', err);
      setError('Failed to cancel power down');
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-lg bg-white p-8 shadow dark:bg-gray-800">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
        {t('powerDown')}
      </h2>

      {account && (
        <div className="mb-6 rounded-md bg-gray-50 p-4 dark:bg-gray-700">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 dark:text-gray-400">Current Rate:</p>
              <p className="font-medium text-gray-900 dark:text-white">
                {account.vesting_withdraw_rate}
              </p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400">Next Withdrawal:</p>
              <p className="font-medium text-gray-900 dark:text-white">
                {account.next_vesting_withdrawal}
              </p>
            </div>
          </div>
          {isPoweringDown && (
            <div className="mt-4">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                Power down is currently active
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="shares"
            className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            VESTS to Power Down
          </label>
          <input
            type="number"
            id="shares"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            step="0.000001"
            min="0"
            required={!isPoweringDown}
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
            {isLoading || isPending ? tCommon('loading') : 'Start Power Down'}
          </button>

          {isPoweringDown && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isLoading || isPending}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel Power Down
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
