/**
 * Dark-theme FOUC fix (finding K-5).
 *
 * lib/theme.ts applies the theme class only after hydration, so dark-theme
 * users got a white flash on every full page load. The fix is a blocking
 * inline script, rendered as the first child of <body> in the root layout,
 * that applies the persisted theme class during HTML parsing. These tests
 * pin both halves:
 *  1. the script's runtime behavior (executed against jsdom for each
 *     storage state, including unavailable localStorage),
 *  2. the layout's SSR HTML: the script is present, carries the per-request
 *     CSP nonce, and precedes the page content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { THEME_INIT_SCRIPT } from '@/lib/theme-init';

const mocks = vi.hoisted(() => ({ nonce: 'nonce-abc-123' }));

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));

vi.mock('next-intl/server', () => ({
  getMessages: async () => ({}),
}));

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-nonce' ? mocks.nonce : null),
  }),
}));

vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['en', 'zh', 'es'] },
}));

vi.mock('@/lib/analytics/ga-id', () => ({
  getGaMeasurementId: () => null,
}));

vi.mock('@/app/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/app-layout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const THEME_CLASS_LIST = ['theme-original', 'theme-light', 'theme-dark'];

function runInitScript() {
  new Function(THEME_INIT_SCRIPT)();
}

function currentThemeClass(): string {
  return (
    THEME_CLASS_LIST.find((cls) =>
      document.documentElement.classList.contains(cls)
    ) ?? '(none)'
  );
}

describe('THEME_INIT_SCRIPT runtime behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove(...THEME_CLASS_LIST);
  });

  it('applies the persisted dark theme before first paint', () => {
    localStorage.setItem('wallet-theme', 'dark');
    runInitScript();
    expect(currentThemeClass()).toBe('theme-dark');
  });

  it('applies original and light themes verbatim', () => {
    localStorage.setItem('wallet-theme', 'original');
    runInitScript();
    expect(currentThemeClass()).toBe('theme-original');

    document.documentElement.classList.remove(...THEME_CLASS_LIST);
    localStorage.setItem('wallet-theme', 'light');
    runInitScript();
    expect(currentThemeClass()).toBe('theme-light');
  });

  it('falls back to the default (light) for missing or garbage values', () => {
    runInitScript();
    expect(currentThemeClass()).toBe('theme-light');

    document.documentElement.classList.remove(...THEME_CLASS_LIST);
    localStorage.setItem('wallet-theme', 'banana<script>');
    runInitScript();
    expect(currentThemeClass()).toBe('theme-light');
  });

  it('falls back to the default when localStorage throws (private mode)', () => {
    const windowAny = window as unknown as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(windowAny, 'localStorage');
    Object.defineProperty(windowAny, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    try {
      runInitScript();
    } finally {
      if (descriptor) Object.defineProperty(windowAny, 'localStorage', descriptor);
    }
    expect(currentThemeClass()).toBe('theme-light');
  });
});

describe('root layout SSR HTML', () => {
  it('inlines the nonce-gated theme script before the page content', async () => {
    const { default: LocaleLayout } = await import('@/app/[locale]/layout');
    const layout = await LocaleLayout({
      children: <main data-testid="page">page content</main>,
      params: Promise.resolve({ locale: 'en' }),
    });
    const html = renderToStaticMarkup(layout);

    // Present, nonce-gated (proxy.ts CSP uses 'strict-dynamic': an un-nonced
    // inline script would be blocked and the FOUC would return), and running
    // before any body content is parsed.
    const scriptIndex = html.indexOf(`<script nonce="${mocks.nonce}">`);
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(html.slice(scriptIndex)).toContain('wallet-theme');

    const contentIndex = html.indexOf('page content');
    expect(contentIndex).toBeGreaterThan(scriptIndex);
  });

  it('omits the nonce attribute when no nonce header is present', async () => {
    mocks.nonce = '';
    try {
      const { default: LocaleLayout } = await import('@/app/[locale]/layout');
      const layout = await LocaleLayout({
        children: <main>page content</main>,
        params: Promise.resolve({ locale: 'en' }),
      });
      const html = renderToStaticMarkup(layout);

      // No x-nonce header → no nonce attr (e.g. direct hits that bypass the
      // proxy); the script still ships and applies the theme.
      expect(html).toContain('<script>(function');
      expect(html).not.toContain('nonce=');
    } finally {
      mocks.nonce = 'nonce-abc-123';
    }
  });
});
