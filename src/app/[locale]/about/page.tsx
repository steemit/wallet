import { getTranslations } from 'next-intl/server';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { AboutPageContent } from '@/components/content/about-page';

export default async function AboutPage() {
  const t = await getTranslations('wallet');

  return (
    <StaticPageShell title={t('navAbout')}>
      <AboutPageContent />
    </StaticPageShell>
  );
}
