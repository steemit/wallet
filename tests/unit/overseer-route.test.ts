import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

const collectOverseer = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    collectOverseer: (...args: unknown[]) => collectOverseer(...args),
  },
}));

import { POST } from '@/app/api/analytics/overseer/route';
import { verifyCSRF, rateLimit } from '@/lib/middleware';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/analytics/overseer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 't' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analytics/overseer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCSRF).mockResolvedValue(null);
    vi.mocked(rateLimit).mockResolvedValue(null);
    collectOverseer.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('relays a route tag with the legacy overseer shape', async () => {
    const res = await POST(
      makeRequest({
        kind: 'route',
        tag: 'market',
        trackingId: 'aabbccddeeff00112233445566',
        isLogin: true,
      })
    );
    expect(res.status).toBe(200);
    expect(collectOverseer).toHaveBeenCalledWith({
      measurement: 'route',
      tags: { app: 'wallet', tag: 'market', is_login: true },
      fields: { trackingId: 'aabbccddeeff00112233445566' },
    });
  });

  it('relays a transfer user action', async () => {
    const res = await POST(
      makeRequest({
        kind: 'action',
        action: 'transfer',
        params: { transferCoin: 'STEEM', amount: 1, from: 'alice', to: 'bob' },
      })
    );
    expect(res.status).toBe(200);
    expect(collectOverseer).toHaveBeenCalledWith(
      expect.objectContaining({
        measurement: 'user_action',
        tags: expect.objectContaining({ action_type: 'transfer', transfer_coin: 'STEEM' }),
        fields: { from_username: 'alice', to_username: 'bob', amount: 1 },
      })
    );
  });

  it('rejects an unknown action (allowlist)', async () => {
    const res = await POST(makeRequest({ kind: 'action', action: 'drop_table' }));
    expect(res.status).toBe(400);
    expect(collectOverseer).not.toHaveBeenCalled();
  });

  it('rejects a malformed tracking id', async () => {
    const res = await POST(
      makeRequest({ kind: 'route', tag: 'market', trackingId: 'not-hex' })
    );
    expect(res.status).toBe(400);
    expect(collectOverseer).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind', async () => {
    const res = await POST(makeRequest({ kind: 'ad' }));
    expect(res.status).toBe(400);
    expect(collectOverseer).not.toHaveBeenCalled();
  });

  it('accepts a string amount and an empty proxy (clear proxy)', async () => {
    const res = await POST(
      makeRequest({
        kind: 'action',
        action: 'account_witness_proxy',
        params: { username: 'alice', proxy: '' },
      })
    );
    expect(res.status).toBe(200);
    expect(collectOverseer).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: { username: 'alice', proxy: '' },
      })
    );
  });

  it('drops invalid account params instead of relaying them', async () => {
    const res = await POST(
      makeRequest({
        kind: 'action',
        action: 'transfer',
        params: { from: 'NOT VALID', to: 'bob', amount: 1, transferCoin: 'STEEM' },
      })
    );
    expect(res.status).toBe(200);
    const payload = collectOverseer.mock.calls[0]?.[0] as {
      fields: { from_username: string; to_username: string };
    };
    expect(payload.fields.from_username).toBe('');
    expect(payload.fields.to_username).toBe('bob');
  });

  it('returns success when overseer relay throws (do not break the client)', async () => {
    collectOverseer.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(
      makeRequest({
        kind: 'route',
        tag: 'index',
        trackingId: 'aabbccddeeff00112233445566',
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});
