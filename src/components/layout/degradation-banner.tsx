'use client';

import { useTranslations } from 'next-intl';
import { useServiceHealth, type ServiceHealthStatus } from '@/hooks/use-service-health';

const bannerStyles: Record<ServiceHealthStatus, string> = {
  healthy: '',
  degraded:
    'bg-amber-100 dark:bg-amber-900/30 border-b border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200',
  outage:
    'bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700 text-red-800 dark:text-red-200',
  unknown: '',
};

export function DegradationBanner() {
  const t = useTranslations('wallet');
  const status = useServiceHealth();

  if (status === 'healthy' || status === 'unknown') return null;

  const message =
    status === 'outage' ? t('outageBanner') : t('degradedBanner');

  return (
    <div className={`px-4 py-2 text-center text-sm ${bannerStyles[status]}`}>
      {message}
    </div>
  );
}
