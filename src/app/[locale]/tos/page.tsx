import { getTranslations } from 'next-intl/server';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { HelpMarkdown } from '@/components/content/help-markdown';
import { readHelpMarkdown } from '@/lib/content/read-help-file';

export default async function TermsPage() {
  const t = await getTranslations('wallet');
  const content = readHelpMarkdown('tos');

  return (
    <StaticPageShell title={t('navTermsOfService')}>
      <HelpMarkdown content={content} />
    </StaticPageShell>
  );
}
