import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockValidateTransactionShape = vi.fn();
const mockBroadcastTransaction = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    validateTransactionShape: (...args: unknown[]) => mockValidateTransactionShape(...args),
    broadcastTransaction: (...args: unknown[]) => mockBroadcastTransaction(...args),
  },
}));

const mockCacheDeleteByPrefix = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  cacheDeleteByPrefix: (...args: unknown[]) => mockCacheDeleteByPrefix(...args),
}));

import { POST } from '@/app/api/broadcast/claim-reward-balance/route';

const VALID_TX = { signatures: ['sig'], operations: [['claim_reward_balance', {}]], extensions: [] };

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://test/api/broadcast/claim-reward-balance', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/broadcast/claim-reward-balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockValidateTransactionShape.mockReturnValue(true);
    mockBroadcastTransaction.mockResolvedValue({ id: 'trx', block_num: 1, trx_num: 1, expired: false });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it('relays a valid tx and invalidates ONLY the accounts cache', async () => {
    // A claim moves reward_* into balances — account data only. The op does
    // not touch savings withdrawals, conversions or open orders, so the
    // user-scoped wallet-estimate-extras delete (copied from transfer) must
    // NOT happen. Pinned so future copy-paste drift fails here.
    const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));

    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalledWith(VALID_TX);
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledTimes(1);
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith('cache:query:accounts');
    // The removed X-Cache-Invalidate channel must stay gone.
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });

  it('400 when body missing fields', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });

  it('400 when tx shape invalid', async () => {
    mockValidateTransactionShape.mockReturnValue(false);
    const res = await POST(
      makeRequest({ signedTx: { signatures: [], operations: [], extensions: [] }, username: 'alice' })
    );
    expect(res.status).toBe(400);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
    expect(mockCacheDeleteByPrefix).not.toHaveBeenCalled();
  });

  it('403 when CSRF fails (never reaches broadcast)', async () => {
    const { NextResponse } = await import('next/server');
    mockVerifyCSRF.mockResolvedValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));
    expect(res.status).toBe(403);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });

  it('429 passes through when rate limited', async () => {
    const { NextResponse } = await import('next/server');
    mockRateLimit.mockResolvedValue(NextResponse.json({ error: 'rate limited' }, { status: 429 }));
    const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));
    expect(res.status).toBe(429);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });
});
