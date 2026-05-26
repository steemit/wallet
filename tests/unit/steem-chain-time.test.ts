import { describe, expect, it } from 'vitest';
import {
  formatSteemIsoTimestamp,
  unixSecToSteemIsoTimestamp,
} from '@/lib/steem/chain-time';

describe('steem chain time', () => {
  it('formats ISO timestamps without subseconds or Z', () => {
    const iso = formatSteemIsoTimestamp(new Date('2026-05-26T11:11:52.123Z'));
    expect(iso).toBe('2026-05-26T11:11:52');
    expect(iso).not.toContain('.');
    expect(iso).not.toContain('Z');
  });

  it('converts unix seconds to Steem ISO timestamps', () => {
    expect(unixSecToSteemIsoTimestamp(0)).toBe('1970-01-01T00:00:00');
  });
});
