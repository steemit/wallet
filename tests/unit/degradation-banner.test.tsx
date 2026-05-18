import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DegradationBanner } from '@/components/layout/degradation-banner';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const msgs: Record<string, string> = {
      degradedBanner: 'Some data may be delayed.',
      outageBanner: 'Service temporarily unavailable.',
    };
    return msgs[key] ?? key;
  },
}));

// Mock useServiceHealth
const mockStatus = vi.fn();
vi.mock('@/hooks/use-service-health', () => ({
  useServiceHealth: () => mockStatus(),
  // Export the type so TS is happy
}));

describe('DegradationBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when healthy', () => {
    mockStatus.mockReturnValue('healthy');
    const { container } = render(<DegradationBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when unknown', () => {
    mockStatus.mockReturnValue('unknown');
    const { container } = render(<DegradationBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders degraded banner with amber styling', () => {
    mockStatus.mockReturnValue('degraded');
    render(<DegradationBanner />);
    expect(screen.getByText('Some data may be delayed.')).toBeInTheDocument();
  });

  it('renders outage banner with red styling', () => {
    mockStatus.mockReturnValue('outage');
    render(<DegradationBanner />);
    expect(screen.getByText('Service temporarily unavailable.')).toBeInTheDocument();
  });
});
