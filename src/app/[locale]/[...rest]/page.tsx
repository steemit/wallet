import { notFound } from 'next/navigation';

/**
 * Locale-scoped catch-all (next-intl "Catching unknown routes" pattern).
 *
 * With `localePrefix: 'never'`, the proxy rewrites every unknown document path
 * to `/{locale}/<path>` (e.g. `/foo/bar` -> `/en/foo/bar`). Without a
 * catch-all, such paths match no route and fall through to the bare framework
 * 404 (unstyled, no locale, no chrome). Throwing `notFound()` here instead
 * renders the localized `../not-found.tsx` inside the app layout.
 */
export default function CatchAllPage(): never {
  notFound();
}
