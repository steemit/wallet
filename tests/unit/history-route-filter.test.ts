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

  it('returns all matching ops from one batch and correct nextFrom', async () => {
    // Batch: 5 transfers at indices 900-904.
    mockGetAccountHistory.mockResolvedValue(makeTuples(900, 5, 'transfer'));

    const req = makeRequest({ username: 'alice', ops: 'transfer' });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.history).toHaveLength(5);
    // Oldest index in batch = 900; nextFrom = 899.
    expect(body.nextFrom).toBe(899);
    expect(body.exhausted).toBe(false);
    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
  });

  it('advances nextFrom using oldest index in whole batch, not just matching items', async () => {
    // Batch: 98 non-matching ops (indices 2-99) + 2 matching ops (indices 100-101).
    // nextFrom must be min(ALL indices) - 1 = 2 - 1 = 1, not min(matching) - 1 = 99.
    const batch = [
      ...makeTuples(2, 98, 'vote'),
      ...makeTuples(100, 2, 'transfer'),
    ];
    mockGetAccountHistory.mockResolvedValue(batch);

    const req = makeRequest({ username: 'alice', ops: 'transfer' });
    const res = await GET(req);
    const body = await res.json();

    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
    expect(body.history).toHaveLength(2);
    expect(body.nextFrom).toBe(1); // oldest in WHOLE batch = 2 → nextFrom = 1
    expect(body.exhausted).toBe(false);
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

  it('makes exactly one Steem RPC call per HTTP request', async () => {
    mockGetAccountHistory.mockResolvedValue(makeTuples(900, 100, 'vote'));

    const req = makeRequest({ username: 'alice', limit: '10', ops: 'transfer' });
    await GET(req);

    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
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

  it('clamps fetchLimit to the from value when near history start', async () => {
    // When from=3, fetchLimit must be min(100, max(1, 3)) = 3, not 100.
    mockGetAccountHistory.mockResolvedValue(makeTuples(1, 3, 'transfer'));

    const req = makeRequest({ username: 'alice', from: '3', ops: 'transfer' });
    await GET(req);

    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
    const call = mockGetAccountHistory.mock.calls[0] as [string, number, number];
    expect(call[1]).toBe(3); // fetchLimit = min(100, max(1, from=3)) = 3
    expect(call[2]).toBe(3); // from = 3
  });

  it('uses full BATCH_SIZE when from is large (load-more request)', async () => {
    // from=500 is well above BATCH_SIZE=100, so fetchLimit = min(100, max(1, 500)) = 100.
    mockGetAccountHistory.mockResolvedValue(makeTuples(400, 100, 'transfer'));

    const req = makeRequest({ username: 'alice', from: '500', ops: 'transfer' });
    await GET(req);

    expect(mockGetAccountHistory).toHaveBeenCalledTimes(1);
    const call = mockGetAccountHistory.mock.calls[0] as [string, number, number];
    expect(call[1]).toBe(100); // fetchLimit = min(100, max(1, 500)) = 100
    expect(call[2]).toBe(500); // from passed through unchanged
  });

  it('treats empty ops param as no filter (legacy path)', async () => {
    // ops= (empty string) is falsy → requestedOps is null → legacy path.
    const rawHistory = makeTuples(900, 5, 'transfer');
    mockGetAccountHistory.mockResolvedValue(rawHistory);

    const req = makeRequest({ username: 'alice', ops: '' });
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.history).toHaveLength(5);
    // Legacy path does not add nextFrom or exhausted to the response.
    expect(body.nextFrom).toBeUndefined();
    expect(body.exhausted).toBeUndefined();
  });
});
