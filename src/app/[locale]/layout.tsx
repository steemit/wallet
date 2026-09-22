import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { Providers } from '../providers';
import { AppLayout } from '@/components/layout/app-layout';
import { GoogleAnalytics } from '@/components/analytics/google-analytics';
import { GoogleAnalyticsPageviews } from '@/components/analytics/google-analytics-pageviews';
import { getGaMeasurementId } from '@/lib/analytics/ga-id';
import { THEME_INIT_SCRIPT } from '@/lib/theme-init';
import '../globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// All routes render per-request (condenser #4012 parity): runtime env like
// GOOGLE_ANALYTICS_ID must never be baked into prerendered HTML. Pages are
// already dynamic because of the CSP-nonce headers() call below; this export
// makes the invariant explicit and independent of that mechanism. No
// generateStaticParams here on purpose — with force-dynamic it would be a
// no-op (it is only meaningful for statically prerendered routes).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Steemit Wallet',
  description: 'Steemit Wallet is an online wallet for managing Steem accounts.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicons/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [
      { url: '/favicons/apple-touch-icon.png', sizes: '180x180' },
    ],
  },
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();
  const gaId = getGaMeasurementId();
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang={locale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Theme applied during HTML parsing, before the first paint —
            dark-theme users would otherwise get a white flash on every full
            page load (lib/theme.ts only touches the DOM after hydration).
            Classic blocking inline script as the first child of <body>; runs
            before any body content is painted. It carries the CSP nonce
            (proxy.ts mints one per request) — without it 'strict-dynamic'
            would block the script and the FOUC would return. Like the GA
            scripts below it must stay in its own fragment with no 'use
            client' siblings so React emits it in the SSR HTML. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
          {...(nonce ? { nonce } : {})}
        />
        {/* GA scripts must stay in a fragment free of 'use client' elements —
            a client sibling inside the SAME fragment makes React defer the
            scripts to hydration instead of emitting them in the SSR HTML.
            Hence two separate conditionals, not one shared fragment. */}
        {gaId ? <GoogleAnalytics measurementId={gaId} {...(nonce ? { nonce } : {})} /> : null}
        {gaId ? <GoogleAnalyticsPageviews measurementId={gaId} /> : null}
        <Providers>
          <NextIntlClientProvider messages={messages}>
            <AppLayout>{children}</AppLayout>
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
