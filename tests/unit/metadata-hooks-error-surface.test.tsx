/**
 * Error-surface tests for the two metadata hooks that used to swallow
 * failures entirely (finding G-15): useGlobalProps (delegate/power-down
 * forms) and useProposalsMeta (proposals page header). Both now expose the
 * sibling-hook contract — `error: ''` while fine, a short message after a
 * failed fetch — so a failure is distinguishable from "still loading".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProposalsMeta } from '@/hooks/use-proposals-meta';

// useGlobalProps goes through cachedFetch (L1 client cache); mock the module
// so tests observe exactly one controlled response per case.
const cachedFetchMock = vi.fn();
vi.mock('@/lib/cache/client-fetch', () => ({
  cachedFetch: (...args: unknown[]) => cachedFetchMock(...args),
}));

// Imported after the vi.mock declaration above takes effect.
import { useGlobalProps } from '@/hooks/use-global-props';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown): Response {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('useGlobalProps error surface', () => {
  beforeEach(() => {
    cachedFetchMock.mockReset();
  });

  it('reports success with a props payload and no error', async () => {
    const props = {
      total_vesting_shares: '1.000000000 VESTS',
      total_vesting_fund_steem: '1.000 STEEM',
    };
    cachedFetchMock.mockResolvedValue({ data: { props } });
    const { result } = renderHook(() => useGlobalProps());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.globalProps).toEqual(props);
    expect(result.current.error).toBe('');
  });

  it('exposes an error when the route responds without props', async () => {
    cachedFetchMock.mockResolvedValue({
      data: { success: false, error: 'upstream unavailable' },
    });
    const { result } = renderHook(() => useGlobalProps());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.globalProps).toBeNull();
    expect(result.current.error).toBe('upstream unavailable');
  });

  it('exposes an error when the fetch rejects', async () => {
    cachedFetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useGlobalProps());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.globalProps).toBeNull();
    expect(result.current.error).toBe('Failed to fetch global properties');
  });
});

describe('useProposalsMeta error surface', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('reports success with stats and no error', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        success: true,
        daoTreasury: '1000.000 SBD',
        dailyBudget: '100.000 SBD',
        paidProposalIds: [7],
        treasuryFeeSbd: '5.000 SBD',
      })
    );
    const { result } = renderHook(() => useProposalsMeta());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.daoTreasury).toBe('1000.000 SBD');
    expect(result.current.paidProposalIds).toEqual([7]);
    expect(result.current.error).toBe('');
  });

  it('exposes the server error when success is false', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ success: false, error: 'conveyor timeout' })
    );
    const { result } = renderHook(() => useProposalsMeta());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.daoTreasury).toBeNull();
    expect(result.current.error).toBe('conveyor timeout');
  });

  it('exposes an error when the fetch rejects or the body is garbage', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useProposalsMeta());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch proposals overview');

    // A retry that succeeds clears the error.
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, daoTreasury: '1.000 SBD' })
    );
    await result.current.refreshMeta();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(result.current.daoTreasury).toBe('1.000 SBD');
  });
});
