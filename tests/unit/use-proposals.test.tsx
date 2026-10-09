/**
 * useProposals — race guard (G-6) + optimistic vote support + no-store
 * refresh (K-3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useProposals } from '@/hooks/use-proposals';
import type { Proposal } from '@/lib/steem/types';

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getGlobalProps: vi.fn().mockResolvedValue({ props: { total_vesting_shares: '1 VESTS' } }),
  },
}));

const mockFetch = vi.fn();

function proposal(id: number, upVoted = false): Proposal {
  return {
    id,
    proposal_id: id,
    creator: 'creator',
    receiver: 'receiver',
    start_date: '2026-01-01T00:00:00',
    end_date: '2027-01-01T00:00:00',
    daily_pay: '10.000 SBD',
    subject: `proposal ${id}`,
    permlink: 'permlink',
    total_votes: 0,
    upVoted,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function okJson(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('useProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('drops the previous query’s late response on filter change (G-6)', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ u }) => useProposals(u), {
      initialProps: { u: 'alice' as string | null },
    });

    rerender({ u: 'bob' });

    await act(async () => {
      second.resolve(okJson({ success: true, proposals: [proposal(2)] }));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      first.resolve(okJson({ success: true, proposals: [proposal(1)] }));
    });

    expect(result.current.proposals).toHaveLength(1);
    expect(result.current.proposals[0]?.proposal_id).toBe(2);
  });

  it('setProposalVotedLocally flips upVoted without a network round trip (K-3)', async () => {
    mockFetch.mockResolvedValue(okJson({ success: true, proposals: [proposal(7, false)] }));

    const { result } = renderHook(() => useProposals('alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposals[0]?.upVoted).toBe(false);

    act(() => {
      result.current.setProposalVotedLocally(7, true);
    });

    expect(result.current.proposals[0]?.upVoted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setProposalVotedLocally(7, false);
    });
    expect(result.current.proposals[0]?.upVoted).toBe(false);
  });

  it('refresh({ noStore: true }) bypasses the 15s HTTP cache (K-3)', async () => {
    mockFetch.mockResolvedValue(okJson({ success: true, proposals: [] }));

    const { result } = renderHook(() => useProposals('alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/query/proposals?status=votable&order=by_total_votes&direction=descending&limit=50&username=alice',
      undefined
    );

    await act(async () => {
      await result.current.refresh({ noStore: true });
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/query/proposals?status=votable&order=by_total_votes&direction=descending&limit=50&username=alice',
      { cache: 'no-store' }
    );
  });
});
