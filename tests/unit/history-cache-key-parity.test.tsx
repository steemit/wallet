/**
 * Client history cache-key parity tests (review finding C-1).
 *
 * The browser L1 cache keys for activity/rewards history are built from the
 * page username. When the URL carries "/@Alice" but other navigation paths
 * produce "alice", raw keys duplicated entries for the same account
 * (`activity:Alice` vs `activity:alice`). The key component must be
 * normalized so one account = one key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActivityHistory } from '@/hooks/use-activity-history';
import { useRewardsHistory } from '@/hooks/use-rewards-history';
import { clientCache } from '@/lib/cache/client-cache';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

vi.mock('@/lib/steem/client', () => ({
  apiClient: { getHistory: vi.fn() },
}));

import { apiClient } from '@/lib/steem/client';

const mockGetHistory = apiClient.getHistory as unknown as ReturnType<typeof vi.fn>;

const oneItem: SteemHistoryItem[] = [
  {
    op: ['transfer', { from: 'bob', to: 'alice', amount: '1.000 STEEM' }],
    timestamp: '2026-09-01T10:00:00',
    block: 1000000,
    trx_id: 'trx-1',
    index: 1,
  },
];

describe('useActivityHistory — normalized L1 cache key', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue({ history: oneItem, nextFrom: null, exhausted: true });
    clientCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads/writes the SAME key whatever case/@ the page username carries', async () => {
    const getSpy = vi.spyOn(clientCache, 'get');

    const a = renderHook(() => useActivityHistory('Alice'));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    a.unmount();

    const b = renderHook(() => useActivityHistory('@alice '));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    b.unmount();

    const keys = getSpy.mock.calls.map((c) => c[0]);
    expect(keys).toContain('activity:alice');
    expect(keys.some((k) => k !== 'activity:alice')).toBe(false);
  });
});

describe('useRewardsHistory — normalized L1 cache key', () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    mockGetHistory.mockResolvedValue({ history: [], nextFrom: null, exhausted: true });
    clientCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the normalized account in the rewards key', async () => {
    const getSpy = vi.spyOn(clientCache, 'get');

    const { result } = renderHook(() => useRewardsHistory('Alice', 'curation_reward'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const keys = getSpy.mock.calls.map((c) => c[0]);
    expect(keys).toContain('rewards:alice:curation_reward');
    expect(keys.some((k) => k !== 'rewards:alice:curation_reward')).toBe(false);
  });
});
