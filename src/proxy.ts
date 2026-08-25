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

function buildCsp(nonce: string): string {
  // Development needs 'unsafe-eval' for React DevTools' error stack reconstruction.
  const devExtras = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devExtras}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
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

export default function proxy(request: NextRequest) {
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
  return response;
}

export const config = {
  // Match all pathnames except api and Next internals.
  // Do NOT use "path contains a dot" (.*\..*) — Steem sub-accounts use dots (e.g. user.subaccount).
  matcher: [
    '/((?!api|trpc|_next|_vercel|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
