'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function RewardsLoadMore({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  const t = useTranslations('wallet');
  return (
    <div className="mt-4 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={loading}
        onClick={onClick}
      >
        {loading ? t('rewardsLoadingMore') : t('rewardsLoadMore')}
      </Button>
    </div>
  );
}
