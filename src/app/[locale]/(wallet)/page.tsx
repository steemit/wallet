'use client';

import { useRequireAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { RecentActivityLazy } from '@/components/wallet/client-wrappers';

// BalanceCards is shown above the fold, load it normally
import { BalanceCards } from '@/components/wallet/balance-cards';

export default function WalletPage() {
  const { username, isAuthenticated } = useRequireAuth();
  const t = useTranslations('wallet');

  if (!isAuthenticated || !username) {
    return (
      <div className="flex justify-center py-12">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {t('title')}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t('welcome')}, {username}
        </p>
      </div>

      {/* Balance Cards - loaded immediately (above the fold) */}
      <BalanceCards />

      {/* Recent Activity - lazy loaded (below the fold, makes API calls) */}
      <RecentActivityLazy username={username} />
    </div>
  );
}
