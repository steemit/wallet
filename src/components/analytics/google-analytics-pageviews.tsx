'use client';

import { useEffect } from 'react';
// next/navigation's usePathname, NOT @/i18n/routing's: this component renders
// in the layout OUTSIDE NextIntlClientProvider, where next-intl's usePathname
// throws during SSR (React's error recovery then swallows sibling server
// content). With localePrefix 'never' both hooks return the same path.
import { usePathname } from 'next/navigation';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * SPA virtual pageviews for gtag. The loader + init scripts render in the SSR
 * HTML (see google-analytics.tsx) and execute at parse time, so window.gtag
 * exists before hydration and the first effect run already reports the
 * initial pageview — the init config sets send_page_view:false so this effect
 * is the single source of pageviews (no double-count on first load).
 *
 * Must use gtag('event', 'page_view', ...), NOT another gtag('config') call:
 * once send_page_view:false is set, re-issuing config with page_path does not
 * reliably emit a page_view (GA4 "Measure pageviews" docs). page_location /
 * page_referrer are filled automatically by gtag.
 */
export function GoogleAnalyticsPageviews({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', {
      page_path: pathname,
      page_title: document.title,
      send_to: measurementId,
    });
  }, [pathname, measurementId]);

  return null;
}
