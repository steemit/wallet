/**
 * gtag loader rendered straight into the SSR HTML so the browser loads it at
 * parse time — no client-side injection, no hydration dependency (wallet-legacy
 * `server-html.jsx` parity; also what condenser settled on in its #4010 fix).
 * Init config: cookie_domain auto + send_page_view:false (SPA pageviews are
 * reported by GoogleAnalyticsPageviews — render it as a SEPARATE sibling
 * conditional in the layout, never inside the same fragment: any 'use client'
 * element sharing a fragment with these scripts makes React defer them to
 * hydration instead of emitting them in the SSR HTML).
 *
 * Legacy's sample_rate:5 is intentionally NOT carried over: it is a Universal
 * Analytics field, absent from the GA4 config reference — dead code for G-
 * measurement ids.
 *
 * measurementId must arrive validated (getGaMeasurementId — strict GA id
 * regex) since it is interpolated into an inline script.
 *
 * Both scripts carry the CSP nonce: with 'strict-dynamic' the host allowlist
 * only applies to legacy browsers, so an un-nonced script would be blocked.
 */
export function GoogleAnalytics({
  measurementId,
  nonce,
}: {
  measurementId: string;
  nonce?: string;
}) {
  const scriptProps = nonce ? { nonce } : {};

  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        {...scriptProps}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}', {
  cookie_domain: 'auto',
  send_page_view: false
});`,
        }}
        {...scriptProps}
      />
    </>
  );
}
