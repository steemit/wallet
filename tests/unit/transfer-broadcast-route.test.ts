import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashedUserCachePrefix } from '@/lib/cache/cache-key';

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

import { POST } from '@/app/api/broadcast/transfer/route';

const VALID_TX = { signatures: ['sig'], operations: [['transfer', {}]], extensions: [] };

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://test/api/broadcast/transfer', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/broadcast/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockValidateTransactionShape.mockReturnValue(true);
    mockBroadcastTransaction.mockResolvedValue({ id: 'trx', block_num: 1, trx_num: 1, expired: false });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it('relays a valid tx and deletes the HASHED per-user cache prefix', async () => {
    // Regression guard for review finding A-1: the route used to interpolate
    // the plaintext username, which can never match the sha256-hashed keys the
    // query routes store. The expected argument is derived from the REAL key
    // construction, not an invented shape.
    const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));

    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalledWith(VALID_TX);
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith('cache:query:accounts');
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith(
      hashedUserCachePrefix('cache:query:wallet-estimate-extras', 'alice')
    );
    // Accounts + extras only — the semantically-unrelated withdraw-routes
    // delete was copy-paste drift and must stay dropped.
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledTimes(2);
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });

  it('does not fail the response when username is a non-string truthy value', async () => {
    // Routes only truthiness-check username (the `as` cast is compile-time
    // only). Invalidation runs AFTER a successful broadcast, so a garbage
    // value must degrade to a harmless no-op scan — never throw and report
    // the already-broadcast transaction as a 500.
    const res = await POST(makeRequest({ signedTx: VALID_TX, username: 12345 }));

    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalledTimes(1);
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith(
      hashedUserCachePrefix('cache:query:wallet-estimate-extras', 12345 as unknown as string)
    );
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
});
