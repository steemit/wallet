/**
 * Raw apiClient getters must surface the X-Degraded signal (residual from the
 * #347 audit). cachedFetch consumers already write the header into the shared
 * degradation-state store; the plain-fetch query getters (getHistory,
 * getWitnesses, getGlobalProps, getOwnerHistory, getWithdrawRoutes,
 * getMedianHistoryPrice, getMarketData, fetchTransactionHeader) used to skip
 * it, so those pages only learned about degradation from the 60s health poll.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, SteemSigner } from '@/lib/steem/client';
import { setDegraded, subscribeToDegradation } from '@/lib/cache/degradation-state';

function mockResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

describe('apiClient raw getters — X-Degraded signal propagation', () => {
  let degradedEvents: boolean[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    setDegraded(false);
    degradedEvents = [];
    unsubscribe = subscribeToDegradation((v) => degradedEvents.push(v));
  });

  afterEach(() => {
    unsubscribe();
    setDegraded(false);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('getHistory notifies degradation subscribers when X-Degraded: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ history: [] }, { 'X-Degraded': 'true' }))
    );

    await apiClient.getHistory('alice', 100);

    expect(degradedEvents).toEqual([true]);
  });

  it.each([
    {
      name: 'getWitnesses',
      call: () => apiClient.getWitnesses(50),
    },
    {
      name: 'getGlobalProps',
      call: () => apiClient.getGlobalProps(),
    },
    {
      name: 'getOwnerHistory',
      call: () => apiClient.getOwnerHistory('alice'),
    },
    {
      name: 'getWithdrawRoutes',
      call: () => apiClient.getWithdrawRoutes('alice'),
    },
    {
      name: 'getMedianHistoryPrice',
      call: () => apiClient.getMedianHistoryPrice(),
    },
    {
      name: 'getMarketData',
      call: () => apiClient.getMarketData(),
    },
  ])('$name propagates X-Degraded: true', async ({ call }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ success: true }, { 'X-Degraded': 'true' }))
    );

    await call();

    expect(degradedEvents).toEqual([true]);
  });

  it('a later healthy response clears the degraded state again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ history: [] }, { 'X-Degraded': 'true' }))
      .mockResolvedValueOnce(mockResponse({ history: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.getHistory('alice', 100);
    await apiClient.getHistory('alice', 100);

    expect(degradedEvents).toEqual([true, false]);
  });

  it('signing path (transaction header) also reads the signal', async () => {
    const { steem } = await import('@steemit/steem-js');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse(
          { success: true, ref_block_num: 1, ref_block_prefix: 2, expiration: '2030-01-01T00:00:00' },
          { 'X-Degraded': 'true' }
        )
      )
    );
    vi.mocked(steem.auth.signTransaction).mockReturnValue({} as never);

    await SteemSigner.signTransaction([['vote', {} as never]], ['5Jtest']);

    expect(degradedEvents).toEqual([true]);
  });
});
