'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const LoadingFallback = () => (
  <div className="mt-8 flex flex-col gap-3">
    <Skeleton className="h-6 w-24 mb-4" />
    {[1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

// Lazy load components that are not immediately visible
export const RecentActivityLazy = dynamic(
  () => import('@/components/wallet/recent-activity').then((mod) => ({ default: mod.RecentActivity })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);

const RewardsSectionFallback = () => (
  <div className="UserWallet space-y-4">
    <Skeleton className="h-10 w-full max-w-xl" />
    <Skeleton className="h-px w-full" />
    <Skeleton className="h-6 w-48" />
    <Skeleton className="h-40 w-full" />
  </div>
);

export const CurationRewardsSectionLazy = dynamic(
  () =>
    import('@/components/wallet/curation-rewards-section').then((mod) => ({
      default: mod.CurationRewardsSection,
    })),
  { loading: RewardsSectionFallback, ssr: false }
);

export const AuthorRewardsSectionLazy = dynamic(
  () =>
    import('@/components/wallet/author-rewards-section').then((mod) => ({
      default: mod.AuthorRewardsSection,
    })),
  { loading: RewardsSectionFallback, ssr: false }
);

export const DelegationsSectionLazy = dynamic(
  () =>
    import('@/components/wallet/delegations-section').then((mod) => ({
      default: mod.DelegationsSection,
    })),
  { loading: RewardsSectionFallback, ssr: false }
);

export const PermissionsSectionLazy = dynamic(
  () =>
    import('@/components/wallet/permissions-section').then((mod) => ({
      default: mod.PermissionsSection,
    })),
  { loading: RewardsSectionFallback, ssr: false }
);

export const CommunitiesSectionLazy = dynamic(
  () =>
    import('@/components/wallet/communities-section').then((mod) => ({
      default: mod.CommunitiesSection,
    })),
  { loading: RewardsSectionFallback, ssr: false }
);

export const WitnessesPageClient = dynamic(
  () => import('@/components/wallet/witness-vote-form').then((mod) => ({ default: mod.WitnessVoteForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);
