'use client';

import { useTranslations } from 'next-intl';
import { StaticPageShell } from '@/components/layout/static-page-shell';

export default function SupportPage() {
  const t = useTranslations('wallet.support');
  return (
    <StaticPageShell title={t('title')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('emailHint')}{' '}
        <a href="mailto:contact@steemit.com" className="text-primary hover:underline">
          contact@steemit.com
        </a>
        .
      </p>
    </StaticPageShell>
  );
}
