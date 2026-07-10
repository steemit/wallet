import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

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
  let forIntl: NextRequest = request;
  if (normalized !== null) {
    const url = request.nextUrl.clone();
    url.pathname = normalized;
    forIntl = new NextRequest(url, {
      method: request.method,
      headers: request.headers,
    });
  }
  return intlMiddleware(forIntl);
}

export const config = {
  // Match all pathnames except api and Next internals.
  // Do NOT use "path contains a dot" (.*\..*) — Steem sub-accounts use dots (e.g. user.subaccount).
  matcher: [
    '/((?!api|trpc|_next|_vercel|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
