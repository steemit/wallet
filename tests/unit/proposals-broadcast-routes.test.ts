import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockVerifySignature = vi.fn();
const mockBroadcastTransaction = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    verifySignature: (...args: unknown[]) => mockVerifySignature(...args),
    broadcastTransaction: (...args: unknown[]) => mockBroadcastTransaction(...args),
  },
}));

const mockCacheDeleteByPrefix = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  cacheDeleteByPrefix: (...args: unknown[]) => mockCacheDeleteByPrefix(...args),
}));

import { POST as POST_CREATE } from '@/app/api/broadcast/proposal-create/route';
import { POST as POST_REMOVE } from '@/app/api/broadcast/proposal-remove/route';

describe('proposal broadcast routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockVerifySignature.mockResolvedValue(true);
    mockBroadcastTransaction.mockResolvedValue({ id: 'trx', block_num: 1, trx_num: 1, expired: false });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it('returns 400 when create body missing fields', async () => {
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when create tx invalid', async () => {
    mockVerifySignature.mockResolvedValue(false);
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: [], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when remove tx invalid', async () => {
    mockVerifySignature.mockResolvedValue(false);
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: [], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when remove body missing fields', async () => {
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(400);
  });

  it('broadcasts create and invalidates proposals cache', async () => {
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({
        signedTx: { signatures: ['sig'], operations: [['create_proposal', {}]], extensions: [] },
        username: 'alice',
      }),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalled();
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith('cache:query:proposals');
  });

  it('broadcasts remove and invalidates proposals cache', async () => {
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({
        signedTx: { signatures: ['sig'], operations: [['remove_proposal', {}]], extensions: [] },
        username: 'alice',
      }),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalled();
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith('cache:query:proposals');
  });

  it('short-circuits when CSRF fails', async () => {
    mockVerifyCSRF.mockResolvedValue(new Response('csrf', { status: 403 }));
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: ['sig'], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(403);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });

  it('short-circuits when rate limit returns a response', async () => {
    mockRateLimit.mockResolvedValue(new Response('rl', { status: 429 }));
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: ['sig'], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(429);
  });

  it('short-circuits create when rate limited', async () => {
    mockRateLimit.mockResolvedValue(new Response('rl', { status: 429 }));
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: ['sig'], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(429);
  });

  it('returns 500 on broadcast exception', async () => {
    mockBroadcastTransaction.mockRejectedValue(new Error('boom'));
    const req = new Request('http://test/api/broadcast/proposal-create', {
      method: 'POST',
      body: JSON.stringify({
        signedTx: { signatures: ['sig'], operations: [['create_proposal', {}]], extensions: [] },
        username: 'alice',
      }),
    });
    const res = await POST_CREATE(req as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed');
  });

  it('returns 500 on remove broadcast exception', async () => {
    mockBroadcastTransaction.mockRejectedValue(new Error('boom'));
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({
        signedTx: { signatures: ['sig'], operations: [['remove_proposal', {}]], extensions: [] },
        username: 'alice',
      }),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(500);
  });

  it('short-circuits remove when CSRF fails', async () => {
    mockVerifyCSRF.mockResolvedValue(new Response('csrf', { status: 403 }));
    const req = new Request('http://test/api/broadcast/proposal-remove', {
      method: 'POST',
      body: JSON.stringify({ signedTx: { signatures: ['sig'], operations: [], extensions: [] }, username: 'alice' }),
    });
    const res = await POST_REMOVE(req as never);
    expect(res.status).toBe(403);
  });
});

