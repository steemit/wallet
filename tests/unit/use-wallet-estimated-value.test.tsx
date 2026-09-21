/**
 * useWalletEstimatedValue — cross-user leak regression (finding G-11).
 *
 * Navigating A's wallet → B's used to keep A's pending conversions /
 * open-order totals in state for the whole load window (balance-rows reads
 * `details` without checking loading). Extras are now tagged with the
 * identity they were fetched for and only exposed while the tag matches, so
 * the stale data vanishes on the first render of the new username.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWalletEstimatedValue } from '@/hooks/use-wallet-estimated-value';

const mockFetch = vi.fn();

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

function extrasBody(username: string) {
  return {
    success: true,
    savingsPendingSteem: 0,
    savingsPendingSbd: 0,
    conversionTotalSbd: 5,
    steemOrders: 1,
    sbdOrders: 2,
    conversions: [{ requestid: 1, amountSbd: 5, finishTime: '2026-01-01T00:00:00' }],
    savingsWithdrawals: [],
    _user: username,
  };
}

function props() {
  return {
    username: 'alice',
    balance: null,
    globalProps: null,
    enabled: true,
  };
}

describe('useWalletEstimatedValue — identity reset (G-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('exposes no previous user’s extras while the new user’s fetch is in flight', async () => {
    // Alice's data resolves immediately.
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('wallet-prices')) {
        return Promise.resolve(okJson({ success: true, steemPrice: 1, sbdPrice: 1 }));
      }
      return Promise.resolve(okJson(extrasBody('alice')));
    });

    const { result, rerender } = renderHook(
      ({ username }) => useWalletEstimatedValue({ ...props(), username }),
      { initialProps: { username: 'alice' } }
    );

    await waitFor(() => expect(result.current.details).not.toBeNull());
    expect(result.current.details?.conversions).toHaveLength(1);

    // Bob's fetch hangs forever — the stale-data window is unbounded.
    const bob = deferred<unknown>();
    mockFetch.mockReset();
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('wallet-prices')) {
        return Promise.resolve(okJson({ success: true, steemPrice: 1, sbdPrice: 1 }));
      }
      return bob.promise as Promise<Response>;
    });

    rerender({ username: 'bob' });

    // From the very first render of the new identity: no alice data.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.details).toBeNull();

    // And bob's data appears once his fetch lands.
    await act(async () => {
      bob.resolve(okJson(extrasBody('bob')));
    });
    await waitFor(() => expect(result.current.details).not.toBeNull());
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/query/wallet-estimate-extras?username=bob&includeOpenOrders=false'
    );
  });

  it('exposes no extras when the username becomes empty', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('wallet-prices')) {
        return Promise.resolve(okJson({ success: true, steemPrice: 1, sbdPrice: 1 }));
      }
      return Promise.resolve(okJson(extrasBody('alice')));
    });

    const { result, rerender } = renderHook(
      ({ username }) => useWalletEstimatedValue({ ...props(), username }),
      { initialProps: { username: 'alice' } }
    );
    await waitFor(() => expect(result.current.details).not.toBeNull());

    rerender({ username: '' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.details).toBeNull();
  });
});
