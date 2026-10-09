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

  it('emits the uniform broadcast success audit log', async () => {
    // All broadcast routes share the logBroadcastSuccess contract: one
    // grep-aggregatable line with op type, route, account and chain tx id.
    // Asserted here (the reference route) so a format change anywhere in
    // broadcast-audit.ts fails loudly.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));
      expect(res.status).toBe(200);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        'Broadcast succeeded: op=transfer route=transfer account=alice tx_id=trx block=1'
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('sanitizes the audit log line against log injection and non-string usernames', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // A crafted username must not be able to forge additional log lines
      // (newlines/tabs stripped); a non-string username must not throw and
      // 500 an already-broadcast transaction.
      const res = await POST(
        makeRequest({
          signedTx: VALID_TX,
          username: 'ev\nil injected=false' as unknown as string,
        })
      );
      expect(res.status).toBe(200);
      const line = infoSpy.mock.calls[0]?.[0] as string;
      expect(line).toBe(
        'Broadcast succeeded: op=transfer route=transfer account=evilinjected=false tx_id=trx block=1'
      );

      const res2 = await POST(makeRequest({ signedTx: VALID_TX, username: 12345 }));
      expect(res2.status).toBe(200);
      expect(infoSpy).toHaveBeenLastCalledWith(
        'Broadcast succeeded: op=transfer route=transfer account=12345 tx_id=trx block=1'
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('emits the uniform failure audit log when the relay throws', async () => {
    // Failure lines across all broadcast routes follow one pattern:
    // `Broadcast failed: route=<route>` + error object.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = new Error('upstream exploded');
      mockBroadcastTransaction.mockRejectedValue(boom);
      const res = await POST(makeRequest({ signedTx: VALID_TX, username: 'alice' }));
      expect(res.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith('Broadcast failed: route=transfer', boom);
    } finally {
      errorSpy.mockRestore();
    }
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
