import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTrackingId, recordRouteTag, userActionRecord } from '@/lib/analytics/overseer';

describe('overseer client helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    );
    document.cookie = 'csrf_token=test-csrf';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('generates a 26-char hex tracking id and reuses it', () => {
    const first = getTrackingId();
    expect(first).toMatch(/^[a-f0-9]{26}$/);
    expect(getTrackingId()).toBe(first);
    expect(localStorage.getItem('wallet_tracking_id')).toBe(first);
  });

  it('POSTs a route event with CSRF', () => {
    const id = getTrackingId();
    recordRouteTag('market', undefined, true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/analytics/overseer',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-csrf',
        }),
      })
    );
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(body).toEqual({
      kind: 'route',
      tag: 'market',
      trackingId: id,
      isLogin: true,
    });
  });

  it('POSTs a user action event', () => {
    userActionRecord('transfer', {
      transferCoin: 'STEEM',
      amount: 1,
      from: 'alice',
      to: 'bob',
    });
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string
    ) as Record<string, unknown>;
    expect(body).toEqual({
      kind: 'action',
      action: 'transfer',
      params: { transferCoin: 'STEEM', amount: 1, from: 'alice', to: 'bob' },
    });
  });

  it('swallows fetch errors', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    expect(() => userActionRecord('change_password', { username: 'alice' })).not.toThrow();
    await Promise.resolve();
  });
});
