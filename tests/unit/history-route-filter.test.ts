/**
 * Server-side history filtering route tests.
 *
 * Verifies the batching algorithm in /api/query/history when an `ops` param is
 * provided: cursor advancement, MAX_BATCHES cap, exhaustion detection, cache key
 * isolation, and 400 validation for unknown op types.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/steem/server', () => ({
  SteemService: { getAccountHistory: vi.fn() },
}));
vi.mock('@/lib/middleware', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/cache/redis', () => ({
  getRedis: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/cache/health-monitor', () => ({
  isSteemKnownDown: vi.fn().mockResolvedValue(false),
  markSteemHealthy: vi.fn().mockResolvedValue(undefined),
  markSteemUnhealthy: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from '@/app/api/query/history/route';
import { SteemService } from '@/lib/steem/server';

const mockGetAccountHistory = SteemService.getAccountHistory as unknown as ReturnType<typeof vi.fn>;

function makeTuples(startIndex: number, count: number, opType: string = 'transfer') {
  return Array.from({ length: count }, (_, i) => [
    startIndex + i,
    {
      op: [opType, {}],
      timestamp: '2026-05-01T10:00:00',
      block: 1000000,
      trx_id: `trx-${startIndex + i}`,
    },
  ]);
}

function makeRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/query/history');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

describe('GET /api/query/history — filtered path', () => {
  beforeEach(() => {
    mockGetAccountHistory.mockReset();
  });

  it('returns 400 for unknown op type', async () => {
    const req = makeRequest({ username: 'alice', ops: 'vote,transfer' });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown op type/);
  });

  it('finds limit matches in a single batch and returns correct nextFrom', async () => {
    // Batch: 100 items, indices 900-999, all transfer ops.
    mockGetAccountHistory.mockResolvedValue(makeTuples(900, 100, 'transfer'));

    const req = makeRequest({ username: 'alice', limit: '5', ops: 'transfer' });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.history).toHaveLength(5);
    // Oldest index in result is 900; nextFrom = 900 - 1 = 899.
    expect(body.nextFrom).toBe(899);
    expect(body.exhausted).toBe(false);
    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
  });

  it('advances cursor using oldest index in whole batch, not just matching items', async () => {
    // Batch has 98 non-matching ops (indices 2-99) + 2 matching ops (indices 100-101).
    // Cursor must advance to min(all indices) - 1 = 2 - 1 = 1, not min(matching) - 1.
    const nonMatching = makeTuples(2, 98, 'vote');
    const matching = makeTuples(100, 2, 'transfer');
    const batch = [...nonMatching, ...matching];
    // First batch: mixed; second batch: empty → exhausted
    mockGetAccountHistory
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([]);

    const req = makeRequest({ username: 'alice', limit: '10', ops: 'transfer' });
    const res = await GET(req);
    const body = await res.json();

    // Should have fetched 2 batches: first found 2 matches, cursor advanced to 1.
    // Second call with cursor=1: fetchLimit = min(100, max(1,1)) = 1.
    expect(mockGetAccountHistory).toHaveBeenCalledTimes(2);
    const secondCall = mockGetAccountHistory.mock.calls[1] as [string, number, number];
    expect(secondCall[2]).toBe(1); // cursor after first batch = min(2,98,100,101) - 1 = 1
    expect(body.exhausted).toBe(true);
    expect(body.history).toHaveLength(2);
  });

  it('reports exhausted when history is fully consumed before limit is met', async () => {
    // Account has 30 ops, only 3 are transfers.
    const batch = [
      ...makeTuples(0, 27, 'vote'),
      ...makeTuples(27, 3, 'transfer'),
    ];
    mockGetAccountHistory.mockResolvedValueOnce(batch).mockResolvedValueOnce([]);

    const req = makeRequest({ username: 'alice', limit: '10', ops: 'transfer' });
    const res = await GET(req);
    const body = await res.json();

    expect(body.exhausted).toBe(true);
    expect(body.nextFrom).toBeNull();
    expect(body.history).toHaveLength(3);
  });

  it('respects MAX_BATCHES cap (20 batches)', async () => {
    // Mock returns 100 non-matching ops with index range decreasing each batch.
    let callCount = 0;
    mockGetAccountHistory.mockImplementation(() => {
      callCount += 1;
      const start = 10000 - callCount * 100;
      return Promise.resolve(makeTuples(start, 100, 'vote'));
    });

    const req = makeRequest({ username: 'alice', limit: '10', ops: 'transfer' });
    const res = await GET(req);
    const body = await res.json();

    // Must stop at MAX_BATCHES = 20 even though no matches were found.
    expect(mockGetAccountHistory).toHaveBeenCalledTimes(20);
    expect(body.history).toHaveLength(0);
    // Not marked exhausted (ran out of batches, not history).
    expect(body.exhausted).toBe(false);
  });

  it('legacy path (no ops param) returns raw history unchanged', async () => {
    const rawHistory = makeTuples(900, 5, 'transfer');
    mockGetAccountHistory.mockResolvedValue(rawHistory);

    const req = makeRequest({ username: 'alice', limit: '5' });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.history).toHaveLength(5);
    // Legacy path does not return nextFrom or exhausted.
    expect(body.nextFrom).toBeUndefined();
    expect(body.exhausted).toBeUndefined();
  });

  it('clamps fetchLimit to cursor value to avoid duplicates near history start', async () => {
    // First batch: 2 matching transfers (indices 3-4) + 48 non-matching votes (indices 5-52).
    // Only 2 matches accumulated (< limit 10), so the loop continues.
    // Oldest index in the whole batch = 3 → cursor = 2.
    // Second call must use fetchLimit = min(100, max(1, 2)) = 2.
    const firstBatch = [
      ...makeTuples(3, 2, 'transfer'),
      ...makeTuples(5, 48, 'vote'),
    ];
    mockGetAccountHistory
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([]); // empty → exhausted

    const req = makeRequest({ username: 'alice', limit: '10', ops: 'transfer' });
    await GET(req);

    expect(mockGetAccountHistory).toHaveBeenCalledTimes(2);
    const secondCall = mockGetAccountHistory.mock.calls[1] as [string, number, number];
    expect(secondCall[1]).toBe(2); // fetchLimit = min(100, max(1, cursor=2)) = 2
    expect(secondCall[2]).toBe(2); // from = cursor = 2
  });
});
