import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// next-intl's middleware module cannot be resolved in the vitest environment;
// the CSP/nonce behavior under test does not depend on intl routing.
vi.mock('next-intl/middleware', () => ({
  default: () => (request: NextRequest) =>
    NextResponse.next({ request: { headers: request.headers } }),
}));
vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['en'], defaultLocale: 'en' },
}));

import proxy from '@/proxy';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

describe('proxy CSP nonce', () => {
  it('sets a CSP response header with a nonce and strict-dynamic on page responses', () => {
    const res = proxy(req('/market'));
    const csp = res.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    const scriptSrc = csp!.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Arbitrary on-chain profile/cover image URLs must load (legacy parity: imgSrc '*').
    expect(csp).toContain("img-src 'self' blob: data: https:");
  });

  it('generates a fresh nonce per request', () => {
    const csp1 = proxy(req('/market')).headers.get('content-security-policy');
    const csp2 = proxy(req('/market')).headers.get('content-security-policy');
    expect(csp1).toBeTruthy();
    expect(csp1).not.toBe(csp2);
  });

  it('mirrors the same nonce into the request headers seen by the renderer', () => {
    const request = req('/market');
    proxy(request);
    const nonce = request.headers.get('x-nonce');
    const cspReq = request.headers.get('content-security-policy');
    expect(nonce).toBeTruthy();
    expect(cspReq).toContain(`'nonce-${nonce}'`);
  });

  it('keeps the /@account normalization working with the nonce applied', () => {
    const request = req('/@alice/transfers');
    const res = proxy(request);
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('skips CSP on the healthcheck short-circuit', () => {
    const res = proxy(req('/.well-known/healthcheck.json'));
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});
