import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import './globals.css';

/**
 * Root-level 404 fallback (English-only by design).
 *
 * Serves the cases `src/app/[locale]/not-found.tsx` cannot:
 *  - `notFound()` thrown by `[locale]/layout.tsx` itself (an invalid locale
 *    value reaching the layout — the proxy's rewrite normally prevents this,
 *    but the layout check is the documented safety net). A boundary never
 *    catches its own layout, so this is the nearest one above it.
 *  - unmatched routes outside the `[locale]` tree (proxy-excluded paths).
 *
 * It renders through Next's implicit root layout, outside the locale layout
 * and its NextIntlClientProvider, so it must not call useTranslations. It
 * imports globals.css itself because the only other import site is
 * `[locale]/layout.tsx`, which does not render here.
 */
export default function RootNotFound() {
  return (
    <div
      role="alert"
      className="bg-background text-foreground flex min-h-screen items-center justify-center p-4"
    >
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
