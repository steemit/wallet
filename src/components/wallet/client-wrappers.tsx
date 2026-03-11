'use client';

import { FormSkeleton } from '@/components/ui/loading-skeleton';
import { useRequireAuth } from '@/hooks/use-auth';
import dynamic from 'next/dynamic';

// Lazy-loaded wallet forms with client-only rendering
const DelegateFormLazy = dynamic(
  () => import('@/components/wallet/delegate-form').then(mod => ({ default: mod.DelegateForm })),
  {
    loading: () => <FormSkeleton />,
    ssr: false,
  }
);

const PowerDownFormLazy = dynamic(
  () => import('@/components/wallet/power-down-form').then(mod => ({ default: mod.PowerDownForm })),
  {
    loading: () => <FormSkeleton />,
    ssr: false,
  }
);

const TransferFormLazy = dynamic(
  () => import('@/components/wallet/transfer-form').then(mod => ({ default: mod.TransferForm })),
  {
    loading: () => <FormSkeleton />,
    ssr: false,
  }
);

const WitnessVoteFormLazy = dynamic(
  () => import('@/components/wallet/witness-vote-form').then(mod => ({ default: mod.WitnessVoteForm })),
  {
    loading: () => <FormSkeleton />,
    ssr: false,
  }
);

const RecentActivityLazy = dynamic(
  () => import('@/components/wallet/recent-activity').then(mod => ({ default: mod.RecentActivity })),
  {
    loading: () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4"></div>
        <FormSkeleton />
      </div>
    ),
    ssr: false,
  }
);

/**
 * Client wrapper for delegations page
 */
export function DelegationsPageClient() {
  useRequireAuth();
  return <DelegateFormLazy />;
}

/**
 * Client wrapper for power-down page
 */
export function PowerDownPageClient() {
  useRequireAuth();
  return <PowerDownFormLazy />;
}

/**
 * Client wrapper for transfer page
 */
export function TransferPageClient() {
  useRequireAuth();
  return <TransferFormLazy />;
}

/**
 * Client wrapper for witnesses page
 */
export function WitnessesPageClient() {
  useRequireAuth();
  return <WitnessVoteFormLazy />;
}

/**
 * Client wrapper for recent activity component
 */
export { RecentActivityLazy };
