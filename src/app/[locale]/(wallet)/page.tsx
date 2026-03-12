'use client';

import { useRequireAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { RecentActivityLazy } from '@/components/wallet/client-wrappers';
import { BalanceCards } from '@/components/wallet/balance-cards';
import { ThemeSwitcher } from '@/components/ui/theme-switcher';

export default function WalletPage() {
  const { username, isAuthenticated } = useRequireAuth();
  const t = useTranslations('wallet');

  if (!isAuthenticated || !username) {
    return (
      <div className="flex justify-center py-12">
        <div className="text-center">
          <p className="text-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header with Theme Switcher */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            {t('title')}
          </h1>
          <p className="mt-2 text-text-secondary">
            {t('welcome')}, {username}
          </p>
        </div>
        <ThemeSwitcher />
      </div>

      {/* Balance Cards - loaded immediately (above the fold) */}
      <BalanceCards />

      {/* Recent Activity - lazy loaded (below the fold, makes API calls) */}
      <RecentActivityLazy username={username} />
    </div>
  );
}
