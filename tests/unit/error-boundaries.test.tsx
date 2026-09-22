/**
 * Route-level boundary components (finding K-2: no error.tsx / not-found.tsx /
 * global-error.tsx anywhere in src/app).
 *
 * Covers the tiers added in this change:
 *  1. `src/app/[locale]/not-found.tsx` — localized 404 (rendered via the
 *     `[...rest]` catch-all) inside the app chrome,
 *  2. `src/app/[locale]/error.tsx` — segment error boundary: message, reset
 *     wiring, home link, no error-detail leakage, dev-only console logging,
 *  3. `src/app/global-error.tsx` — self-contained <html>/<body> last resort,
 * plus the root `src/app/not-found.tsx` English fallback and the mechanism
 * check that a synchronous throw in a server page (the /faq ENOENT scenario
 * from read-help-file.ts) is contained by an error boundary.
 *
 * No `[locale]/loading.tsx` ships with this change: a Suspense boundary at
 * the locale root makes every `notFound()` below it (including the catch-all)
 * respond 200 instead of 404 — the streaming shell locks the status code —
 * and the data-heavy pages already carry their own segment-local Suspense
 * skeletons (market, proposals, [username]).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { type ReactNode } from 'react';

vi.mock('next-intl', () => ({
  // Return the defaultMessage when provided so assertions read like the UI.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    (values?.defaultMessage as string | undefined) ?? key,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

// Render next/link as a plain anchor so href attributes are assertable in
// jsdom without an App Router context.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const notFoundMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

const readHelpMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/read-help-file', () => ({
  readHelpMarkdown: readHelpMock,
}));

import NotFoundPage from '@/app/[locale]/not-found';
import LocaleError from '@/app/[locale]/error';
import RootNotFound from '@/app/not-found';
import GlobalError from '@/app/global-error';
import CatchAllPage from '@/app/[locale]/[...rest]/page';
import FaqPage from '@/app/[locale]/faq/page';

/**
 * Minimal React error boundary standing in for the one Next.js builds around
 * a route segment when error.tsx exists. The fallback is the real component
 * under test, so this exercises the actual containment path.
 */
class TestErrorBoundary extends React.Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Silence the boundary's dev-gated console output for every test; the
  // logging test asserts against this spy explicitly.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('[locale]/not-found.tsx', () => {
  it('renders the localized title, message and a home link', () => {
    render(<NotFoundPage />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The page you are looking for does not exist or has been moved.'
      )
    ).toBeInTheDocument();

    const home = screen.getByRole('link', { name: 'Back to home' });
    expect(home).toHaveAttribute('href', '/');
  });
});

describe('[locale]/[...rest]/page.tsx', () => {
  it('calls notFound() so unknown locale-scoped paths render the localized boundary', () => {
    // The real notFound() throws a control-flow digest that Next.js routes to
    // the nearest not-found boundary; the mock records the call.
    CatchAllPage();
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});

describe('root not-found.tsx', () => {
  it('renders an English-only fallback with a home link (outside the i18n provider)', () => {
    render(<RootNotFound />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' })
    ).toBeInTheDocument();
    const home = screen.getByRole('link', { name: 'Back to home' });
    expect(home).toHaveAttribute('href', '/');
  });
});

describe('[locale]/error.tsx', () => {
  const boom = new Error('ENOENT: no such file or directory, open /secret/server/path/faq.md');

  it('renders a friendly message with try-again and home affordances', () => {
    const reset = vi.fn();
    render(<LocaleError error={boom} reset={reset} />);

    expect(
      screen.getByRole('heading', { name: 'Something went wrong' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'An unexpected error occurred while loading this page. Please try again.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);

    expect(
      screen.getByRole('link', { name: 'Back to home' })
    ).toHaveAttribute('href', '/');
  });

  it('never renders error details (no message or path leakage)', () => {
    render(<LocaleError error={boom} reset={vi.fn()} />);
    expect(document.body.textContent).not.toContain('secret');
    expect(document.body.textContent).not.toContain('ENOENT');
  });

  it('logs the error to the console outside production and stays silent in production', () => {
    // NODE_ENV is 'test' in vitest — the non-production branch.
    const spy = vi.mocked(console.error);
    const { unmount } = render(<LocaleError error={boom} reset={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(boom);
    unmount();

    vi.stubEnv('NODE_ENV', 'production');
    render(<LocaleError error={boom} reset={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('global-error.tsx', () => {
  it('renders its own html/body document with a reset action', () => {
    // Structural check against the SSR markup (how Next serves it): React
    // DOM's client render hoists <html>/<body> onto the document, so the
    // container markup alone would not show them.
    const markup = renderToStaticMarkup(
      <GlobalError error={new Error('layout crashed')} reset={vi.fn()} />
    );
    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain('<body');

    const reset = vi.fn();
    render(<GlobalError error={new Error('layout crashed')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('never renders error details', () => {
    const secret = new Error('token=abc123 blew up in the layout');
    const { container } = render(<GlobalError error={secret} reset={vi.fn()} />);
    expect(container.textContent).not.toContain('abc123');
  });
});

describe('/faq ENOENT containment (read-help-file crash scenario)', () => {
  it('the page component itself rejects when the help file is missing', async () => {
    readHelpMock.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    // FaqPage calls readHelpMarkdown synchronously during render; a rejected
    // (or throwing) server component is exactly what Next.js routes into the
    // segment's error.tsx boundary.
    await expect(FaqPage()).rejects.toThrow('ENOENT');
  });

  it('a render-time throw renders the error boundary fallback instead of the page', () => {
    const reset = vi.fn();
    function CrashingPage(): ReactNode {
      // Simulates readHelpMarkdown's synchronous fs.readFileSync ENOENT.
      throw new Error('ENOENT: no such file or directory');
    }

    render(
      <TestErrorBoundary
        fallback={<LocaleError error={new Error('ENOENT')} reset={reset} />}
      >
        <CrashingPage />
      </TestErrorBoundary>
    );

    expect(
      screen.getByRole('heading', { name: 'Something went wrong' })
    ).toBeInTheDocument();
    // The crashing child rendered nothing usable...
    expect(
      screen.queryByText('Frequently Asked Questions')
    ).not.toBeInTheDocument();
    // ...but the recovery affordances are live.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
