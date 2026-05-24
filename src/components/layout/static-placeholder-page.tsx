'use client';

import { useTranslations } from 'next-intl';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { WalletSectionPlaceholder } from '@/components/wallet/wallet-section-placeholder';

export function StaticPlaceholderPage({ titleKey }: { titleKey: string }) {
  const t = useTranslations('wallet');

  return (
    <StaticPageShell title={t(titleKey)}>
      <WalletSectionPlaceholder titleKey={titleKey} />
    </StaticPageShell>
  );
}
