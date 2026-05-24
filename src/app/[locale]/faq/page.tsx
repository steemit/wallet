import { getTranslations } from 'next-intl/server';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { HelpMarkdown } from '@/components/content/help-markdown';
import { readHelpMarkdown } from '@/lib/content/read-help-file';

export default async function FaqPage() {
  const t = await getTranslations('wallet');
  const content = readHelpMarkdown('faq');

  return (
    <StaticPageShell title={t('navFaq')}>
      <HelpMarkdown content={content} />
    </StaticPageShell>
  );
}
