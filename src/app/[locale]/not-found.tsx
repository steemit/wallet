import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { StaticPageShell } from '@/components/layout/static-page-shell';

/**
 * Localized 404 for unknown routes inside a valid locale (thrown by the
 * `[...rest]` catch-all). Renders within `[locale]/layout.tsx`, so the usual
 * site chrome and the `NextIntlClientProvider` from the layout are in place.
 * `notFound()` thrown by the locale layout itself (invalid locale) bubbles to
 * the root `src/app/not-found.tsx` instead — a boundary never catches its own
 * segment's layout.
 */
export default function NotFoundPage() {
  const t = useTranslations('errors');

  return (
    <StaticPageShell title={t('notFoundTitle', { defaultMessage: 'Page not found' })}>
      <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
        {t('notFoundMessage', {
          defaultMessage:
            'The page you are looking for does not exist or has been moved.',
        })}
      </p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        {t('backHome', { defaultMessage: 'Back to home' })}
      </Link>
    </StaticPageShell>
  );
}
