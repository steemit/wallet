import { describe, it, expect, afterEach } from 'vitest';
import { getGaMeasurementId, isValidGaMeasurementId } from '@/lib/analytics/ga-id';

describe('getGaMeasurementId', () => {
  afterEach(() => {
    delete process.env.GOOGLE_ANALYTICS_ID;
    delete process.env.SDC_GOOGLE_ANALYTICS_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  });

  it('returns null when unset', () => {
    delete process.env.GOOGLE_ANALYTICS_ID;
    delete process.env.SDC_GOOGLE_ANALYTICS_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
    expect(getGaMeasurementId()).toBeNull();
  });

  it('prefers GOOGLE_ANALYTICS_ID over the legacy and NEXT_PUBLIC names', () => {
    process.env.GOOGLE_ANALYTICS_ID = 'G-PRIMARY';
    process.env.SDC_GOOGLE_ANALYTICS_ID = 'G-LEGACY';
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID = 'G-PUBLIC';
    expect(getGaMeasurementId()).toBe('G-PRIMARY');
  });

  it('falls back to SDC_GOOGLE_ANALYTICS_ID', () => {
    process.env.SDC_GOOGLE_ANALYTICS_ID = 'UA-1-1';
    expect(getGaMeasurementId()).toBe('UA-1-1');
  });

  it('ignores an invalid value and tries the next candidate', () => {
    process.env.GOOGLE_ANALYTICS_ID = 'not-valid';
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID = 'G-OKAY';
    expect(getGaMeasurementId()).toBe('G-OKAY');
  });

  it('trims whitespace', () => {
    process.env.GOOGLE_ANALYTICS_ID = '  G-TRIMMED  ';
    expect(isValidGaMeasurementId('  G-TRIMMED  ')).toBe(true);
    expect(getGaMeasurementId()).toBe('G-TRIMMED');
  });
});
