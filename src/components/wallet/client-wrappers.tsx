'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const LoadingFallback = () => (
  <div className="mt-8 space-y-3">
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

export const DelegationsPageClient = dynamic(
  () => import('@/components/wallet/delegate-form').then((mod) => ({ default: mod.DelegateForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);

export const PowerDownPageClient = dynamic(
  () => import('@/components/wallet/power-down-form').then((mod) => ({ default: mod.PowerDownForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);

export const TransferPageClient = dynamic(
  () => import('@/components/wallet/transfer-form').then((mod) => ({ default: mod.TransferForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);

export const WitnessesPageClient = dynamic(
  () => import('@/components/wallet/witness-vote-form').then((mod) => ({ default: mod.WitnessVoteForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);
