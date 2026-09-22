import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// The REAL next-intl middleware runs here (vitest.config.ts inlines next-intl
// so its extensionless 'next/server' import resolves) — no mock double. This
// matters because proxy.ts relies on the real middleware's contract: whatever
// request headers proxy.ts sets BEFORE handing off (the CSP nonce pair) must
// surface on the rewritten request the middleware produces. NextResponse
// encodes forwarded request headers as `x-middleware-request-<name>` response
// headers plus an `x-middleware-override-headers` manifest, so the contract is
// observable without a Next server.

import proxy from '@/proxy';

type ProxyResponse = Awaited<ReturnType<typeof proxy>>;

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

/** Header value the intl middleware forwarded to the rewritten request. */
function forwardedRequestHeader(res: ProxyResponse, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

/** True when the response came out of the real intl middleware (rewrite or
 * override headers present) — i.e. the request was NOT passed through as a
 * static asset. */
function wentThroughIntl(res: ProxyResponse): boolean {
  return (
    res.headers.has('x-middleware-rewrite') ||
    res.headers.has('x-middleware-override-headers')
  );
}

describe('proxy CSP nonce', () => {
  it('sets a CSP response header with a nonce and strict-dynamic on page responses', async () => {
    const res = await proxy(req('/market'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    const scriptSrc = csp!.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Arbitrary on-chain profile/cover image URLs must load (legacy parity: imgSrc '*').
    expect(csp).toContain("img-src 'self' blob: data: https:");
    // gtag (legacy google_analytics_id) needs connect + a script-src host fallback.
    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).toContain('https://www.google-analytics.com');
    expect(csp).toContain('https://*.google-analytics.com');
  });

  it('generates a fresh nonce per request', async () => {
    const csp1 = (await proxy(req('/market'))).headers.get('content-security-policy');
    const csp2 = (await proxy(req('/market'))).headers.get('content-security-policy');
    expect(csp1).toBeTruthy();
    expect(csp1).not.toBe(csp2);
  });

  it('forwards the nonce through the REAL intl middleware to the rewritten request', async () => {
    // The load-bearing contract: proxy.ts must set the nonce on the REQUEST
    // headers before handing off to the intl middleware, and the real
    // middleware must carry them onto its rewrite. If either side breaks
    // (proxy stops setting request headers, or the middleware stops
    // forwarding them), the renderer never sees the nonce and hydration
    // fails in production.
    const res = await proxy(req('/market'));

    // The real middleware rewrote the bare path into the default locale tree.
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://localhost/en/market');
    // ...and declared our request headers as overrides for the rewrite.
    const overrideManifest = res.headers.get('x-middleware-override-headers');
    expect(overrideManifest).toContain('x-nonce');
    expect(overrideManifest).toContain('content-security-policy');

    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    const nonce = forwardedRequestHeader(res, 'x-nonce');
    expect(nonce).toBeTruthy();
    // The nonce reaching the renderer matches the one in the served CSP.
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(forwardedRequestHeader(res, 'content-security-policy')).toBe(csp);
  });

  it('keeps the /@account normalization working through the real intl middleware', async () => {
    const res = await proxy(req('/@alice/transfers'));
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost/en/alice/transfers'
    );
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
    const nonce = forwardedRequestHeader(res, 'x-nonce');
    expect(nonce).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain(`'nonce-${nonce}'`);
  });

  it('skips CSP on the healthcheck short-circuit', async () => {
    const res = await proxy(req('/.well-known/healthcheck.json'));
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('proxy static asset passthrough', () => {
  it('passes nested public asset requests straight through (no intl rewrite)', async () => {
    for (const path of [
      '/favicons/favicon-16x16.png',
      '/images/about/mission.jpg',
      '/images/foo.png',
      '/favicons/apple-touch-icon.png',
    ]) {
      const res = await proxy(req(path));
      // Plain NextResponse.next(): no intl rewrite, no request-header overrides,
      // and no CSP — the static handler serves these untouched.
      expect(wentThroughIntl(res)).toBe(false);
      expect(res.headers.get('content-security-policy')).toBeNull();
    }
  });

  it('routes bare single-segment account-shaped paths like /user.png through intl', async () => {
    // `user.png` is a valid Steem account name (dots are legal); external
    // bare links must reach the account page, not 404 against public/.
    const res = await proxy(req('/user.png'));
    expect(wentThroughIntl(res)).toBe(true);
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://localhost/en/user.png');
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('still routes plain pages through intl', async () => {
    const res = await proxy(req('/faq'));
    expect(wentThroughIntl(res)).toBe(true);
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://localhost/en/faq');
  });

  it('still routes bare account paths without an extension through intl', async () => {
    const res = await proxy(req('/@alice'));
    expect(wentThroughIntl(res)).toBe(true);
    expect(res.headers.get('x-middleware-rewrite')).toBe('http://localhost/en/alice');
  });

  it('still routes account paths that merely contain dots', async () => {
    const res1 = await proxy(req('/@user.subaccount'));
    expect(wentThroughIntl(res1)).toBe(true);
    expect(res1.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost/en/user.subaccount'
    );
    const res2 = await proxy(req('/user.subaccount/transfers'));
    expect(wentThroughIntl(res2)).toBe(true);
    expect(res2.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost/en/user.subaccount/transfers'
    );
  });

  it('applies CSP + csrf cookie to page requests as before', async () => {
    const res = await proxy(req('/market'));
    expect(wentThroughIntl(res)).toBe(true);
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
    expect(res.headers.getSetCookie().some((c) => c.startsWith('NEXT_LOCALE='))).toBe(
      true
    );
  });
});
