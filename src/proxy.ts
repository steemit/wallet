import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

/**
 * Per-request CSP nonce. The RSC streaming payload (`self.__next_f.push(...)`) is delivered via
 * framework-generated inline scripts, so a bare `script-src 'self'` blocks hydration entirely
 * (SRI integrity attributes only cover external scripts). A random per-request nonce lets the
 * framework inline scripts run while injected scripts (no nonce) stay blocked.
 * 'strict-dynamic' extends trust to chunks loaded at runtime by already-trusted scripts.
 * All pages render dynamically behind this proxy, so the nonce costs no static optimization.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// CSRF cookie issuance.
//
// The double-submit CSRF token (see src/lib/middleware/csrf.ts) is stateless:
// `base64url(timestamp).base64url(HMAC-SHA256(CSRF_SECRET, timestamp))`. Minting
// it here on every document response means the cookie exists from the very
// first page load, so anonymous visitors (who never call /api/auth/challenge —
// previously the only issuance point) can POST analytics events. Any instance
// can verify tokens minted by any other because they share CSRF_SECRET.
//
// The middleware runs in the edge runtime, where node:crypto is unavailable;
// Web Crypto (crypto.subtle) produces the exact same HMAC-SHA256 bytes. A unit
// test asserts parity with the Node-side generator. Without a configured
// CSRF_SECRET nothing is minted — mirroring the fail-closed posture of the
// Node verifier (a per-runtime random secret would mint tokens that never
// validate anywhere).
// ---------------------------------------------------------------------------

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_COOKIE_MAX_AGE = 24 * 60 * 60; // 24 hours, matches csrf.ts

const encoder = new TextEncoder();
let hmacKey: { secret: string; key: CryptoKey } | null = null;
let warnedMissingCsrfSecret = false;

function getCsrfSecret(): string | null {
  const envSecret = process.env.CSRF_SECRET;
  if (envSecret && envSecret.trim()) return envSecret.trim();
  if (process.env.NODE_ENV === 'production' && !warnedMissingCsrfSecret) {
    warnedMissingCsrfSecret = true;
    console.error('CSRF_SECRET is not set — proxy mints no CSRF cookie; mutations will be rejected');
  }
  return null;
}

function toBase64url(binary: string): string {
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacBase64url(secret: string, message: string): Promise<string> {
  if (!hmacKey || hmacKey.secret !== secret) {
    hmacKey = {
      secret,
      key: await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      ),
    };
  }
  const signature = await crypto.subtle.sign('HMAC', hmacKey.key, encoder.encode(message));
  let binary = '';
  for (const b of new Uint8Array(signature)) binary += String.fromCharCode(b);
  return toBase64url(binary);
}

/** Token format identical to generateCSRFToken() in src/lib/middleware/csrf.ts. */
async function generateCsrfToken(secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  // Timestamps are ASCII digits, so btoa == Buffer.from(ts, 'utf8').toString('base64').
  const tsB64 = toBase64url(timestamp);
  const mac = await hmacBase64url(secret, timestamp);
  return `${tsB64}.${mac}`;
}

function buildCsp(nonce: string): string {
  // Development needs 'unsafe-eval' for React DevTools' error stack reconstruction.
  const devExtras = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    // Host allowlists after 'strict-dynamic' are ignored by supporting browsers
    // (the nonce'd gtag loader can fetch further scripts). They remain as a
    // fallback for older browsers, matching wallet-legacy helmet scriptSrc.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://www.googletagmanager.com https://www.google-analytics.com${devExtras}`,
    "style-src 'self' 'unsafe-inline'",
    // profile_image/cover_image are arbitrary URLs from on-chain metadata, so image hosts
    // cannot be allowlisted by name; legacy allowed `imgSrc: *` for the same reason.
    // Scheme-wide https: covers steemitimages/devimages and user URLs; http is upgraded
    // by upgrade-insecure-requests below.
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://analytics.google.com https://*.analytics.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/**
 * Steem wallet URLs use /@account/... (legacy). Next.js treats path segments starting with @ as
 * parallel route slots, so /\@user/... never reaches [username] and becomes a 404. Normalize to
 * /account/... before i18n; pages already strip an optional leading @ from the username param.
 */
function accountPathWithoutAtPrefix(pathname: string): string | null {
  if (!pathname.startsWith('/@')) return null;
  const afterAt = pathname.slice(2);
  if (!afterAt) return null;
  const slashIdx = afterAt.indexOf('/');
  const account = slashIdx === -1 ? afterAt : afterAt.slice(0, slashIdx);
  if (!account || account.includes('@')) return null;
  const suffix = slashIdx === -1 ? '' : afterAt.slice(slashIdx);
  return `/${account}${suffix}`;
}

export default async function proxy(request: NextRequest) {
  // Intercept health check endpoint used by ELB and OpenResty.
  // Must return before i18n middleware to avoid locale redirect issues.
  // Only expose the status; version info (docker_tag/source_commit) is omitted
  // to avoid leaking build-identifying info to anonymous callers.
  if (request.nextUrl.pathname === '/.well-known/healthcheck.json') {
    return NextResponse.json({ status: 'ok' });
  }

  const normalized = accountPathWithoutAtPrefix(request.nextUrl.pathname);

  // Attach the per-request nonce to the request headers BEFORE the intl middleware builds its
  // rewrite response, so the renderer sees them. Next.js parses the nonce out of the CSP request
  // header during render and applies it to framework scripts (external and inline RSC payload).
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);

  let forIntl: NextRequest = request;
  if (normalized !== null) {
    const url = request.nextUrl.clone();
    url.pathname = normalized;
    forIntl = new NextRequest(url, {
      method: request.method,
      headers: request.headers,
    });
  }
  const response = intlMiddleware(forIntl);
  response.headers.set('Content-Security-Policy', csp);

  // Rolling CSRF cookie on every document response: refreshes the 24h window
  // while the user navigates and self-heals after a CSRF_SECRET rotation (one
  // rejected POST at most before the next navigation re-mints). Cookie attrs
  // must stay in sync with setCSRFToken() in src/lib/middleware/csrf.ts.
  const csrfSecret = getCsrfSecret();
  if (csrfSecret) {
    response.cookies.set(CSRF_COOKIE_NAME, await generateCsrfToken(csrfSecret), {
      httpOnly: false, // readable by JS: the client mirrors it into X-CSRF-Token
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: CSRF_COOKIE_MAX_AGE,
      path: '/',
    });
  }
  return response;
}

export const config = {
  // Match all pathnames except api and Next internals.
  // Do NOT use "path contains a dot" (.*\..*) — Steem sub-accounts use dots (e.g. user.subaccount).
  matcher: [
    '/((?!api|trpc|_next|_vercel|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
