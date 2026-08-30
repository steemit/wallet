import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/script', () => ({
  default: function Script({
    children,
    src,
    id,
  }: {
    children?: string;
    src?: string;
    id?: string;
  }) {
    return (
      <script data-testid={id ?? src} src={src}>
        {children}
      </script>
    );
  },
}));

const mockPathname = vi.fn(() => '/market');
vi.mock('@/i18n/routing', () => ({
  usePathname: () => mockPathname(),
}));

import { GoogleAnalytics } from '@/components/analytics/google-analytics';

describe('GoogleAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.dataLayer = [];
    window.gtag = vi.fn();
    mockPathname.mockReturnValue('/market');
  });

  it('loads gtag.js for the measurement id', () => {
    render(<GoogleAnalytics measurementId="G-TESTID" />);
    expect(
      document.querySelector('script[src="https://www.googletagmanager.com/gtag/js?id=G-TESTID"]')
    ).toBeTruthy();
  });

  it('sends a virtual pageview on pathname', () => {
    render(<GoogleAnalytics measurementId="G-TESTID" />);
    expect(window.gtag).toHaveBeenCalledWith('config', 'G-TESTID', { page_path: '/market' });
  });
});
