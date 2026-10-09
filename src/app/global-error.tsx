'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort boundary (finding K-2): renders only when the root-most layout
 * itself throws — in this app `src/app/[locale]/layout.tsx`, since the repo
 * intentionally ships no `src/app/layout.tsx`. Next.js replaces the entire
 * document with this component, so it must render its own <html>/<body> and
 * cannot rely on the layout's providers: no next-intl, no Redux, no chrome.
 * Hence hardcoded terse English — it is the catastrophic-fallback tier.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The application failed to load. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
