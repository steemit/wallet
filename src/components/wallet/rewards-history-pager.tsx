'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RewardsHistoryPager({
  canGoNewer,
  canGoOlder,
  loadingOlder = false,
  onNewer,
  onOlder,
}: {
  canGoNewer: boolean;
  canGoOlder: boolean;
  loadingOlder?: boolean;
  onNewer: () => void;
  onOlder: () => void | Promise<void>;
}) {
  const t = useTranslations('wallet');

  return (
    <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Rewards history pagination">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('h-8', !canGoNewer && 'pointer-events-none opacity-50')}
        disabled={!canGoNewer || loadingOlder}
        onClick={onNewer}
        aria-label="Previous"
      >
        ← {t('rewardsNewer')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('ml-auto h-8', !canGoOlder && 'pointer-events-none opacity-50')}
        disabled={!canGoOlder || loadingOlder}
        onClick={() => void onOlder()}
        aria-label="Next"
        aria-busy={loadingOlder}
      >
        {loadingOlder ? t('rewardsLoadingMore') : `${t('rewardsOlder')} →`}
      </Button>
    </nav>
  );
}
