'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { StaticPageShell } from '@/components/layout/static-page-shell';

/**
 * Route-segment error boundary for the locale tree (finding K-2).
 *
 * Next.js wraps every page under this segment in a React error boundary whose
 * fallback is this component, so a render-time crash (e.g. `readHelpMarkdown`
 * throwing ENOENT on /faq) replaces only the page area — the header, side
 * panel and navigation from the layout keep working.
 *
 * Must stay a Client Component. Never renders error details: message text can
 * carry internal paths or upstream payloads, so the digest-bearing error object
 * only reaches the browser console, and only outside production.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  // The boundary swallows the error object, so mirror it to the console for
  // debugging — gated to non-production per repo convention (transfer-form,
  // login-form). Server-side crashes are already logged by the framework.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }, [error]);

  return (
    <StaticPageShell
      title={t('unexpectedTitle', { defaultMessage: 'Something went wrong' })}
    >
      <p className="text-muted-foreground mb-6 text-sm leading-relaxed">
        {t('unexpectedMessage', {
          defaultMessage:
            'An unexpected error occurred while loading this page. Please try again.',
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => reset()}>
          {t('tryAgain', { defaultMessage: 'Try again' })}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">{t('backHome', { defaultMessage: 'Back to home' })}</Link>
        </Button>
      </div>
    </StaticPageShell>
  );
}
