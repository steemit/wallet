import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// next-intl's middleware module cannot be resolved in the vitest environment;
// the CSP/nonce behavior under test does not depend on intl routing. The mock
// handle must be hoisted so the vi.mock factory can reference it.
const { intlMock } = vi.hoisted(() => ({
  intlMock: vi.fn((request: NextRequest) =>
    NextResponse.next({ request: { headers: request.headers } })
  ),
}));
vi.mock('next-intl/middleware', () => ({
  default: () => intlMock,
}));
vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['en'], defaultLocale: 'en' },
}));

import proxy from '@/proxy';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
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

  it('mirrors the same nonce into the request headers seen by the renderer', async () => {
    const request = req('/market');
    await proxy(request);
    const nonce = request.headers.get('x-nonce');
    const cspReq = request.headers.get('content-security-policy');
    expect(nonce).toBeTruthy();
    expect(cspReq).toContain(`'nonce-${nonce}'`);
  });

  it('keeps the /@account normalization working with the nonce applied', async () => {
    const request = req('/@alice/transfers');
    const res = await proxy(request);
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('skips CSP on the healthcheck short-circuit', async () => {
    const res = await proxy(req('/.well-known/healthcheck.json'));
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('proxy static asset passthrough', () => {
  it('passes public asset requests straight through (no intl rewrite)', async () => {
    intlMock.mockClear();
    for (const path of [
      '/favicons/favicon-16x16.png',
      '/images/about/mission.jpg',
      '/file.svg',
      '/favicons/apple-touch-icon.png',
    ]) {
      const res = await proxy(req(path));
      expect(res.status).toBe(200);
      expect(intlMock).not.toHaveBeenCalled();
      intlMock.mockClear();
    }
  });

  it('still routes account paths that merely contain dots', async () => {
    intlMock.mockClear();
    await proxy(req('/@user.subaccount'));
    expect(intlMock).toHaveBeenCalledTimes(1);
    intlMock.mockClear();
    await proxy(req('/user.subaccount/transfers'));
    expect(intlMock).toHaveBeenCalledTimes(1);
  });

  it('treats /@-rooted paths as accounts even with an asset extension', async () => {
    intlMock.mockClear();
    await proxy(req('/@user.png'));
    expect(intlMock).toHaveBeenCalledTimes(1);
  });

  it('applies CSP + csrf cookie to page requests as before', async () => {
    intlMock.mockClear();
    const res = await proxy(req('/market'));
    expect(intlMock).toHaveBeenCalledTimes(1);
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  });
});
