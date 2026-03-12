'use client';

import { useRequireAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { RecentActivityLazy } from '@/components/wallet/client-wrappers';
import { BalanceRows } from '@/components/wallet/balance-rows';
import { ThemeSwitcher } from '@/components/ui/theme-switcher';
import { Link } from '@/i18n/routing';

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
    <div className="UserWallet">
      {/* Header with navigation and actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-themed">
        {/* Wallet Sub Menu Navigation */}
        <nav className="WalletSubMenu flex flex-wrap gap-4">
          <Link href="/wallet" className="text-base font-bold text-foreground">
            {t('title')}
          </Link>
          <Link
            href="/transfer"
            className="text-base text-text-secondary hover:text-accent transition-colors"
          >
            {t('transfer')}
          </Link>
          <Link
            href="/power-down"
            className="text-base text-text-secondary hover:text-accent transition-colors"
          >
            {t('powerDown')}
          </Link>
          <Link
            href="/delegations"
            className="text-base text-text-secondary hover:text-accent transition-colors"
          >
            {t('delegations')}
          </Link>
          <Link
            href="/witnesses"
            className="text-base text-text-secondary hover:text-accent transition-colors"
          >
            {t('witnesses')}
          </Link>
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-4">
          <Link
            href="/market"
            className="e-btn-hollow inline-block font-bold px-6 py-2 rounded-legacy transition-all"
          >
            {t('buySteem')}
          </Link>
          <ThemeSwitcher />
        </div>
      </div>

      {/* Balance Rows - Legacy layout */}
      <BalanceRows username={username} />

      {/* Recent Activity - lazy loaded */}
      <RecentActivityLazy username={username} />
    </div>
  );
}
