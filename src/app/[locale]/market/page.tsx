import { Suspense } from 'react';
import { MarketPageClient } from '@/components/market/market-page-client';
import { Skeleton } from '@/components/ui/skeleton';

function MarketPageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pt-6 md:px-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<MarketPageFallback />}>
      <MarketPageClient />
    </Suspense>
  );
}
