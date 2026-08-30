'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { usePathname } from '@/i18n/routing';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * gtag loader + SPA pageviews. Matches wallet-legacy:
 * - `server-html.jsx` injects gtag/js + config
 * - `JsPlugins.js` also sets cookie_domain: auto and sample_rate: 5
 *
 * Initial config uses send_page_view: false so the pathname effect is the
 * single source of pageviews (avoids double-counting the first load).
 */
export function GoogleAnalytics({
  measurementId,
  nonce,
}: {
  measurementId: string;
  nonce?: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('config', measurementId, { page_path: pathname });
  }, [pathname, measurementId]);

  const scriptProps = nonce ? { nonce } : {};

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
        {...scriptProps}
      />
      <Script id="ga-gtag-init" strategy="afterInteractive" {...scriptProps}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}', {
            cookie_domain: 'auto',
            sample_rate: 5,
            send_page_view: false
          });
        `}
      </Script>
    </>
  );
}
