'use client';

import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/routing';
import { RecentActivityLazy } from '@/components/wallet/client-wrappers';
import { BalanceRows } from '@/components/wallet/balance-rows';
import { ClaimRewardsBanner } from '@/components/wallet/claim-rewards-banner';
import { useSteemWalletBalances } from '@/hooks/use-steem-wallet-balances';
import { UserProfileBanner } from '@/components/layout/user-profile-banner';
import { AccountWalletNav } from '@/components/layout/account-wallet-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { WalletTransfersModals } from '@/components/wallet/wallet-transfers-modals';
import { WalletSectionPlaceholder } from '@/components/wallet/wallet-section-placeholder';
import {
  AuthorRewardsSectionLazy,
  CurationRewardsSectionLazy,
  DelegationsSectionLazy,
} from '@/components/wallet/client-wrappers';
import { normalizeProfile } from '@/lib/steem/normalize-profile';
import { canManageBalanceForPageUrl } from '@/lib/auth/browser-storage';

type BannerProfileFields = {
  displayName?: string;
  about?: string;
  location?: string;
  website?: string;
  coverImage?: string;
  profileImage?: string;
  createdDate?: string;
};

function bannerFieldsFromAccount(acc: {
  created?: string;
  json_metadata?: string;
  posting_json_metadata?: string;
}): BannerProfileFields {
  const norm = normalizeProfile(acc);
  const out: BannerProfileFields = {};
  if (norm.name) out.displayName = norm.name;
  if (norm.about) out.about = norm.about;
  if (norm.location) out.location = norm.location;
  if (norm.website) out.website = norm.website;
  if (norm.cover_image) out.coverImage = norm.cover_image;
  if (norm.profile_image) out.profileImage = norm.profile_image;
  if (acc.created) out.createdDate = acc.created;
  return out;
}

export default function WalletPage() {
  const { username: loggedInUser, isAuthenticated } = useAuth();
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawUsername = params?.username as string | undefined;
  
  // Parse username from params (e.g. "@ety001" -> "ety001")
  const urlUsername = rawUsername ? decodeURIComponent(rawUsername).replace(/^@/, '') : '';
  const isMyAccount = !!isAuthenticated && !!loggedInUser && loggedInUser === urlUsername;
  const showBalanceActions = canManageBalanceForPageUrl({
    urlUsername,
    loggedInUser,
    isAuthenticated,
  });

  const [walletRefreshNonce, setWalletRefreshNonce] = useState(0);

  const { balance, globalProps, loading: balanceLoading } = useSteemWalletBalances(
    urlUsername,
    walletRefreshNonce
  );

  const [bannerProfile, setBannerProfile] = useState<BannerProfileFields | null>(null);

  useEffect(() => {
    if (!urlUsername) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/query/accounts?names=${encodeURIComponent(urlUsername)}`,
          { cache: 'no-store' }
        );
        const data = (await res.json()) as {
          success?: boolean;
          accounts?: Array<{
            name?: string;
            created?: string;
            json_metadata?: string;
            posting_json_metadata?: string;
          }>;
        };
        if (cancelled || !data.success) {
          if (!cancelled) setBannerProfile({});
          return;
        }
        const acc = data.accounts?.[0];
        if (!acc) {
          if (!cancelled) setBannerProfile({});
          return;
        }
        if (!cancelled) {
          setBannerProfile(bannerFieldsFromAccount(acc));
        }
      } catch {
        if (!cancelled) setBannerProfile({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlUsername]);

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

  const isTransfersPath = pathname?.includes('/transfers') ?? false;
  const isDelegationsPath = pathname?.includes('/delegations') ?? false;
  const isPermissionsPath = pathname?.includes('/permissions') ?? false;
  const isPasswordPath = pathname?.includes('/password') ?? false;
  const isCommunitiesPath = pathname?.includes('/communities') ?? false;
  const isCurationRewardsPath = pathname?.includes('/curation-rewards') ?? false;
  const isAuthorRewardsPath = pathname?.includes('/author-rewards') ?? false;

  return (
    <div>
      {/* User Profile Banner - matches legacy UserProfile.jsx */}
      <UserProfileBanner
        accountname={urlUsername}
        isMyAccount={isMyAccount}
        {...(bannerProfile ?? {})}
      />

      <AccountWalletNav
        accountname={urlUsername}
        isMyAccount={isMyAccount}
        showOwnerWalletNav={showBalanceActions}
      />

      {/* Wallet content: keep top padding tight under AccountWalletNav */}
      <div className="mx-auto max-w-6xl space-y-3 px-4 pt-3 pb-6">
        {isTransfersPath && (
          <ClaimRewardsBanner
            balance={balance}
            isMyAccount={isMyAccount}
            loading={balanceLoading}
          />
        )}

        {isTransfersPath && (
          <>
            <BalanceRows
              username={urlUsername}
              balance={balance}
              globalProps={globalProps}
              loading={balanceLoading}
              showBalanceActions={showBalanceActions}
            />
            <RecentActivityLazy username={urlUsername} refreshNonce={walletRefreshNonce} />
          </>
        )}
        {isDelegationsPath && (
          <DelegationsSectionLazy
            key={`delegations-${urlUsername}`}
            username={urlUsername}
            globalProps={globalProps}
            globalPropsLoading={balanceLoading}
            isMyAccount={isMyAccount}
          />
        )}
        {isPermissionsPath && <WalletSectionPlaceholder titleKey="keysAndPermissions" />}
        {isPasswordPath && <WalletSectionPlaceholder titleKey="changePassword" />}
        {isCommunitiesPath && <WalletSectionPlaceholder titleKey="communities" />}
        {isCurationRewardsPath && (
          <CurationRewardsSectionLazy
            key={`curation-${urlUsername}`}
            username={urlUsername}
            globalProps={globalProps}
            globalPropsLoading={balanceLoading}
          />
        )}
        {isAuthorRewardsPath && (
          <AuthorRewardsSectionLazy
            key={`author-${urlUsername}`}
            username={urlUsername}
            globalProps={globalProps}
            globalPropsLoading={balanceLoading}
          />
        )}
      </div>

      <Suspense fallback={null}>
        {isTransfersPath && (
          <WalletTransfersModals
            onWalletDataChanged={() => setWalletRefreshNonce((n) => n + 1)}
          />
        )}
      </Suspense>
    </div>
  );
}
