/**
 * useServiceHealth wiring tests (K-1): the hook merges the 60s /api/health
 * poll with the per-response degradation signal (degradation-state, written
 * by cachedFetch from X-Degraded headers) so a degraded query response shows
 * the banner within its normal render cycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useServiceHealth } from '@/hooks/use-service-health';
import { setDegraded } from '@/lib/cache/degradation-state';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function healthResponse(status: string): Response {
  return {
    json: () => Promise.resolve({ status }),
  } as unknown as Response;
}

describe('useServiceHealth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setDegraded(false);
  });

  it('starts unknown, then reflects the polled health', async () => {
    mockFetch.mockResolvedValue(healthResponse('healthy'));
    const { result } = renderHook(() => useServiceHealth());

    expect(result.current).toBe('unknown');
    await waitFor(() => expect(result.current).toBe('healthy'));
  });

  it('polling path still reports degraded/outage without any response signal', async () => {
    mockFetch.mockResolvedValue(healthResponse('degraded'));
    const { result } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('degraded'));

    mockFetch.mockRejectedValue(new Error('network down'));
    // Poll fires on visibility change; simulate returning to the tab.
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current).toBe('outage'));
  });

  it('per-response degraded flag shows degraded immediately (no 60s poll wait)', async () => {
    mockFetch.mockResolvedValue(healthResponse('healthy'));
    const { result } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('healthy'));

    // What cachedFetch does when a response carries X-Degraded: true.
    act(() => setDegraded(true));
    expect(result.current).toBe('degraded');
  });

  it('recovers when a healthy response arrives and the poll says healthy', async () => {
    mockFetch.mockResolvedValue(healthResponse('healthy'));
    const { result } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('healthy'));

    act(() => setDegraded(true));
    expect(result.current).toBe('degraded');

    // What cachedFetch does on the next non-degraded response.
    act(() => setDegraded(false));
    expect(result.current).toBe('healthy');
  });

  it('keeps the banner up while the poll still says degraded even after responses recover', async () => {
    mockFetch.mockResolvedValue(healthResponse('degraded'));
    const { result } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('degraded'));

    // Response signal resets (healthy response) but the poll backstop still
    // reports degraded → the banner must stay visible.
    act(() => setDegraded(false));
    expect(result.current).toBe('degraded');
  });

  it('outage outranks the per-response degraded flag', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('outage'));

    act(() => setDegraded(true));
    expect(result.current).toBe('outage');
  });

  it('stops listening to the response signal after unmount', async () => {
    mockFetch.mockResolvedValue(healthResponse('healthy'));
    const { result, unmount } = renderHook(() => useServiceHealth());
    await waitFor(() => expect(result.current).toBe('healthy'));

    unmount();
    // No React warnings/crashes from a late notification after unmount.
    act(() => setDegraded(true));
    setDegraded(false);
  });
});
