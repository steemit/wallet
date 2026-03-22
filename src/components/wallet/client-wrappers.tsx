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

export const WitnessesPageClient = dynamic(
  () => import('@/components/wallet/witness-vote-form').then((mod) => ({ default: mod.WitnessVoteForm })),
  {
    loading: LoadingFallback,
    ssr: false,
  }
);
