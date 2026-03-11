'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/steem/client';

interface Transaction {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  memo: string;
  timestamp: string;
}

interface RecentActivityProps {
  username: string;
}

export function RecentActivity({ username }: RecentActivityProps) {
  const t = useTranslations('wallet');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await apiClient.getHistory(username, 10);

        if (response.error) {
          setError(response.error);
          return;
        }

        // Process history data
        const history = response.history || [];
        // Format: [sequence, op] - we need to extract relevant info
        const formatted: Transaction[] = (history as [number, unknown[]][])
          .slice()
          .reverse()
          .map(([sequence, op]) => {
            const opArray = op as unknown[];
            const opType = opArray[0] as string;
            const opData = opArray[1] as Record<string, unknown>;
            return {
              id: `${sequence}`,
              type: opType,
              from: (opData.from as string) || '',
              to: (opData.to as string) || '',
              amount: (opData.amount as string) || '',
              memo: (opData.memo as string) || '',
              timestamp: new Date().toISOString(),
            };
          });

        setTransactions(formatted);
      } catch (err) {
        console.error('Error fetching history:', err);
        setError('Failed to fetch transaction history');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [username]);

  return (
    <div className="rounded-lg bg-white p-6 shadow dark:bg-gray-800">
      <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
        {t('recentActivity')}
      </h2>

      {loading ? (
        <div className="text-center text-gray-500 dark:text-gray-400">
          Loading...
        </div>
      ) : error ? (
        <div className="text-center text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400">
          No recent activity
        </div>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between border-b border-gray-200 pb-3 last:border-0 last:pb-0 dark:border-gray-700"
            >
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">
                  {tx.type}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {tx.from} → {tx.to}
                </p>
                {tx.memo && (
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Memo: {tx.memo}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900 dark:text-white">
                  {tx.amount}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
