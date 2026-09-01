import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const mockPathname = vi.fn(() => '/market');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// RTL cleanup only unmounts the body container; React Float hoists async
// <script src> tags into <head> and dedupes by src per document, so each test
// uses a distinct measurement id to get an unpolluted script element.
afterEach(() => {
  cleanup();
  document.querySelectorAll('head script[src*="googletagmanager"]').forEach((s) => s.remove());
});

import { GoogleAnalytics } from '@/components/analytics/google-analytics';
import { GoogleAnalyticsPageviews } from '@/components/analytics/google-analytics-pageviews';

describe('GoogleAnalytics (SSR scripts)', () => {
  it('renders the parse-time gtag loader with async and the CSP nonce', () => {
    render(<GoogleAnalytics measurementId="G-TESTID" nonce="abc123" />);
    const loader = document.querySelector(
      'script[src="https://www.googletagmanager.com/gtag/js?id=G-TESTID"]'
    );
    expect(loader).toBeTruthy();
    expect(loader!.getAttribute('async')).toBe('');
    expect(loader!.getAttribute('nonce')).toBe('abc123');
  });

  it('renders the inline init with the legacy config and the nonce', () => {
    render(<GoogleAnalytics measurementId="G-TESTID2" nonce="abc123" />);
    const init = document.querySelector('script:not([src])');
    expect(init).toBeTruthy();
    expect(init!.getAttribute('nonce')).toBe('abc123');
    expect(init!.textContent).toContain("gtag('config', 'G-TESTID2'");
    expect(init!.textContent).toContain('cookie_domain: \'auto\'');
    expect(init!.textContent).toContain('sample_rate: 5');
    expect(init!.textContent).toContain('send_page_view: false');
    // Queue shim must be self-contained (no external dependency at parse time).
    expect(init!.textContent).toContain('function gtag(){dataLayer.push(arguments);}');
  });

  it('omits the nonce attribute entirely when none is provided', () => {
    render(<GoogleAnalytics measurementId="G-TESTID3" />);
    expect(
      document.querySelector('script[src*="id=G-TESTID3"]')!.hasAttribute('nonce')
    ).toBe(false);
  });
});

describe('GoogleAnalyticsPageviews (SPA virtual pageviews)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/market');
  });

  it('reports the initial pageview on mount (loader ran at parse time)', () => {
    window.gtag = vi.fn();
    render(<GoogleAnalyticsPageviews measurementId="G-TESTID" />);
    expect(window.gtag).toHaveBeenCalledWith('config', 'G-TESTID', { page_path: '/market' });
  });

  it('reports a pageview whenever the pathname changes', () => {
    window.gtag = vi.fn();
    const { rerender } = render(<GoogleAnalyticsPageviews measurementId="G-TESTID" />);
    mockPathname.mockReturnValue('/proposals');
    rerender(<GoogleAnalyticsPageviews measurementId="G-TESTID" />);
    expect(window.gtag).toHaveBeenLastCalledWith('config', 'G-TESTID', { page_path: '/proposals' });
  });

  it('does nothing when gtag is unavailable (ad-blockers)', () => {
    delete window.gtag;
    expect(() =>
      render(<GoogleAnalyticsPageviews measurementId="G-TESTID" />)
    ).not.toThrow();
  });
});
