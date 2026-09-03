// @vitest-environment node
// Node environment: the middleware's Web Crypto HMAC (crypto.subtle) is a
// global here but not under jsdom; NextRequest/NextResponse are server classes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// next-intl's middleware module cannot be resolved in the vitest environment;
// the CSRF cookie behavior under test does not depend on intl routing.
vi.mock('next-intl/middleware', () => ({
  default: () => (request: NextRequest) =>
    NextResponse.next({ request: { headers: request.headers } }),
}));
vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['en'], defaultLocale: 'en' },
}));

import proxy from '@/proxy';
import { generateCSRFToken, isValidCSRFToken } from '@/lib/middleware/csrf';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`));
}

function csrfSetCookie(res: Awaited<ReturnType<typeof proxy>>): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith('csrf_token='));
}

function csrfCookieValue(res: Awaited<ReturnType<typeof proxy>>): string | null {
  const setCookie = csrfSetCookie(res);
  if (!setCookie) return null;
  return setCookie.split(';')[0]!.split('=').slice(1).join('=');
}

describe('proxy CSRF cookie issuance', () => {
  const originalSecret = process.env.CSRF_SECRET;

  beforeEach(() => {
    process.env.CSRF_SECRET = 'proxy-csrf-test-secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret !== undefined) process.env.CSRF_SECRET = originalSecret;
    else delete process.env.CSRF_SECRET;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sets a csrf_token cookie on document responses', async () => {
    const res = await proxy(req('/market'));
    expect(csrfCookieValue(res)).toBeTruthy();
  });

  it('mints tokens the Node-side verifier accepts (cross-runtime HMAC parity)', async () => {
    const res = await proxy(req('/market'));
    expect(isValidCSRFToken(csrfCookieValue(res)!)).toBe(true);
  });

  it('is byte-identical to the Node generator for the same secret and timestamp', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 1_760_000_000_000);
    const edgeToken = csrfCookieValue(await proxy(req('/market')))!;
    // Same mocked clock, same secret: the edge (Web Crypto) and Node
    // (node:crypto) HMAC outputs must match byte for byte.
    expect(generateCSRFToken()).toBe(edgeToken);
  });

  it('re-mints a fresh token on every response (rolling refresh)', async () => {
    // Base on the real clock: isValidCSRFToken rejects tokens older than 24h.
    let now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = csrfCookieValue(await proxy(req('/market')))!;
    now += 60_000;
    const second = csrfCookieValue(await proxy(req('/market')))!;
    spy.mockRestore();
    expect(first).not.toBe(second);
    expect(isValidCSRFToken(first)).toBe(true);
    expect(isValidCSRFToken(second)).toBe(true);
  });

  it('serializes cookie attributes in sync with setCSRFToken', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await proxy(req('/market'));
    const setCookie = csrfSetCookie(res)!;
    // httpOnly:false -> NO HttpOnly attribute (the client must mirror the
    // cookie into X-CSRF-Token, so it has to stay readable by JS).
    expect(setCookie).not.toContain('HttpOnly');
    // Next serializes sameSite values lowercase; the attribute value is
    // case-insensitive per the Set-Cookie grammar.
    expect(setCookie).toContain('SameSite=strict');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Max-Age=86400');
    expect(setCookie).toContain('Path=/');
  });

  it('mints nothing when CSRF_SECRET is unset (fail-closed, mirrors the verifier)', async () => {
    delete process.env.CSRF_SECRET;
    vi.stubEnv('NODE_ENV', 'production');
    const res = await proxy(req('/market'));
    expect(csrfSetCookie(res)).toBeUndefined();
    // CSP must still be applied — the two concerns are independent.
    expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('does not set the cookie on the healthcheck short-circuit', async () => {
    const res = await proxy(req('/.well-known/healthcheck.json'));
    expect(csrfSetCookie(res)).toBeUndefined();
  });
});
