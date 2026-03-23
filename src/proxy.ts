import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except api and Next internals.
  // Do NOT use "path contains a dot" (.*\..*) — Steem sub-accounts use dots (e.g. user.subaccount).
  matcher: [
    '/((?!api|trpc|_next|_vercel|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
