import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ProposalsPageClient } from '@/components/proposals-page-client';

function ProposalsPageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pt-6 md:px-6">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-12 w-full" />
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

export default function ProposalsPage() {
  return (
    <Suspense fallback={<ProposalsPageFallback />}>
      <ProposalsPageClient />
    </Suspense>
  );
}

