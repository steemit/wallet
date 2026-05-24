import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheckSteemNodeHealth = vi.fn();
const mockGetSteemHealthStale = vi.fn();
const mockAcquireProbeLock = vi.fn();

vi.mock('@/lib/steem/server', () => ({
  checkSteemNodeHealth: (...args: unknown[]) => mockCheckSteemNodeHealth(...args),
}));

vi.mock('@/lib/cache/health-monitor', () => ({
  getSteemHealthStale: (...args: unknown[]) => mockGetSteemHealthStale(...args),
  markSteemHealthy: vi.fn(),
  markSteemUnhealthy: vi.fn(),
  acquireProbeLock: (...args: unknown[]) => mockAcquireProbeLock(...args),
  releaseProbeLock: vi.fn(),
  FRESH_THRESHOLD: 60_000,
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAcquireProbeLock.mockResolvedValue(true);
  });

  it('returns fresh cached healthy without probing', async () => {
    mockGetSteemHealthStale.mockResolvedValue({
      healthy: true,
      checkedAt: Date.now(),
      blockNumber: 99,
      latency: 10,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(mockCheckSteemNodeHealth).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.checks.steem.blockNumber).toBe(99);
  });

  it('dedupes concurrent probes when cache is empty (no false 503)', async () => {
    mockGetSteemHealthStale.mockResolvedValue(null);

    let resolveProbe!: (value: { healthy: boolean; blockNumber: number; latency: number }) => void;
    const probe = new Promise<{ healthy: boolean; blockNumber: number; latency: number }>((resolve) => {
      resolveProbe = resolve;
    });
    mockCheckSteemNodeHealth.mockReturnValue(probe);

    const first = GET();
    const second = GET();

    resolveProbe!({ healthy: true, blockNumber: 1, latency: 5 });

    const [res1, res2] = await Promise.all([first, second]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(mockCheckSteemNodeHealth).toHaveBeenCalledTimes(1);

    const body2 = await res2.json();
    expect(body2.checks.steem.healthy).toBe(true);
  });

  it('includes error message when probe reports unhealthy', async () => {
    mockGetSteemHealthStale.mockResolvedValue(null);
    mockCheckSteemNodeHealth.mockResolvedValue({
      healthy: false,
      error: 'Connection refused',
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.steem.error).toBe('Connection refused');
  });

  it('serves stale cache when probe lock is held', async () => {
    mockGetSteemHealthStale.mockResolvedValue({
      healthy: false,
      checkedAt: Date.now() - 120_000,
      error: 'Previous timeout',
    });
    mockAcquireProbeLock.mockResolvedValue(false);

    const res = await GET();
    expect(res.status).toBe(503);
    expect(mockCheckSteemNodeHealth).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.checks.steem.error).toBe('Previous timeout');
    expect(res.headers.get('X-Health-Stale')).toBe('true');
  });
});
