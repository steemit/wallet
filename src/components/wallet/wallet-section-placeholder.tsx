'use client';

import { useTranslations } from 'next-intl';

export interface WalletSectionPlaceholderProps {
  /** i18n key under `wallet` namespace */
  titleKey: string;
}

export function WalletSectionPlaceholder({ titleKey }: WalletSectionPlaceholderProps) {
  const t = useTranslations('wallet');

  return (
    <div
      className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-14 text-center"
      role="status"
    >
      <h2 className="text-foreground text-lg font-semibold">{t(titleKey)}</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {t('sectionPlaceholderHint')}
      </p>
    </div>
  );
}
