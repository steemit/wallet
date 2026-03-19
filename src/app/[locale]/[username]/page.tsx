'use client';

import { useAuth } from '@/hooks/use-auth';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { RecentActivityLazy } from '@/components/wallet/client-wrappers';
import { BalanceRows } from '@/components/wallet/balance-rows';
import { WalletSubMenu } from '@/components/layout/wallet-sub-menu';
import { UserProfileBanner, TopNav } from '@/components/layout/user-profile-banner';
import { Skeleton } from '@/components/ui/skeleton';

export default function WalletPage() {
  const { username: loggedInUser, isAuthenticated } = useAuth();
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawUsername = params?.username as string | undefined;
  
  // Parse username from params (e.g. "%40ety001" -> "ety001")
  const urlUsername = rawUsername ? decodeURIComponent(rawUsername).replace(/^@/, '') : '';
  const isMyAccount = !!isAuthenticated && !!loggedInUser && loggedInUser === urlUsername;

  // Align with wallet-legacy: user homepage /@username has no content, redirect to /@username/transfers
  const isUserHome = pathname === `/@${urlUsername}` || pathname === `/@${urlUsername}/`;

  useEffect(() => {
    if (!urlUsername) {
      router.push('/');
      return;
    }
    if (isUserHome) {
      router.replace(`/@${urlUsername}/transfers`);
    }
  }, [urlUsername, isUserHome, router]);

  if (!urlUsername || isUserHome) {
    return (
      <div className="flex justify-center py-12">
        <div className="text-center">
          <Skeleton className="h-8 w-48 mx-auto mb-4" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* User Profile Banner - matches legacy UserProfile.jsx */}
      <UserProfileBanner
        accountname={urlUsername}
        isMyAccount={isMyAccount}
      />

      {/* Top Navigation - Blog | Rewards | Wallet */}
      <TopNav
        accountname={urlUsername}
        activeSection="transfers"
      />

      {/* Wallet Content Area */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Wallet Sub Menu - Balances | Delegations | Permissions | etc */}
        <WalletSubMenu accountname={urlUsername} isMyAccount={isMyAccount} />

        {/* Balance Rows - Legacy layout with dropdown menus */}
        <div className="mt-4">
          <BalanceRows username={urlUsername} />
        </div>

        {/* Recent Activity - lazy loaded */}
        <RecentActivityLazy username={urlUsername} />
      </div>
    </div>
  );
}
