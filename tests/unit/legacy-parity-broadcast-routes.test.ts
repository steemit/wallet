import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
const mockSetCacheInvalidateHeader = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  setCacheInvalidateHeader: (...args: unknown[]) => mockSetCacheInvalidateHeader(...args),
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

import { POST as POST_CHANGE_RECOVERY } from '@/app/api/broadcast/change-recovery-account/route';
import { POST as POST_CANCEL_SAVINGS } from '@/app/api/broadcast/cancel-transfer-from-savings/route';

const VALID_TX = { signatures: ['sig'], operations: [['change_recovery_account', {}]], extensions: [] };

function makeRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) }) as never;
}

describe('change-recovery-account / cancel-transfer-from-savings broadcast routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
    mockValidateTransactionShape.mockReturnValue(true);
    mockBroadcastTransaction.mockResolvedValue({ id: 'trx', block_num: 1, trx_num: 1, expired: false });
    mockCacheDeleteByPrefix.mockResolvedValue(undefined);
  });

  it('change-recovery-account: 400 when body missing fields', async () => {
    const res = await POST_CHANGE_RECOVERY(
      makeRequest('http://test/api/broadcast/change-recovery-account', {})
    );
    expect(res.status).toBe(400);
  });

  it('change-recovery-account: 400 when tx shape invalid', async () => {
    mockValidateTransactionShape.mockReturnValue(false);
    const res = await POST_CHANGE_RECOVERY(
      makeRequest('http://test/api/broadcast/change-recovery-account', {
        signedTx: { signatures: [], operations: [], extensions: [] },
        username: 'alice',
      })
    );
    expect(res.status).toBe(400);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });

  it('change-recovery-account: relays valid tx and invalidates caches', async () => {
    const res = await POST_CHANGE_RECOVERY(
      makeRequest('http://test/api/broadcast/change-recovery-account', {
        signedTx: VALID_TX,
        username: 'alice',
      })
    );
    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalledWith(VALID_TX);
    expect(mockCacheDeleteByPrefix).toHaveBeenCalledWith('cache:query:accounts');
    expect(mockSetCacheInvalidateHeader).toHaveBeenCalled();
  });

  it('cancel-transfer-from-savings: 400 when body missing fields', async () => {
    const res = await POST_CANCEL_SAVINGS(
      makeRequest('http://test/api/broadcast/cancel-transfer-from-savings', {})
    );
    expect(res.status).toBe(400);
  });

  it('cancel-transfer-from-savings: relays valid tx', async () => {
    const res = await POST_CANCEL_SAVINGS(
      makeRequest('http://test/api/broadcast/cancel-transfer-from-savings', {
        signedTx: VALID_TX,
        username: 'alice',
      })
    );
    expect(res.status).toBe(200);
    expect(mockBroadcastTransaction).toHaveBeenCalledWith(VALID_TX);
  });

  it('both routes reject when CSRF fails', async () => {
    const { NextResponse } = await import('next/server');
    mockVerifyCSRF.mockResolvedValue(NextResponse.json({ error: 'csrf' }, { status: 403 }));
    const res1 = await POST_CHANGE_RECOVERY(
      makeRequest('http://test/api/broadcast/change-recovery-account', {
        signedTx: VALID_TX,
        username: 'alice',
      })
    );
    const res2 = await POST_CANCEL_SAVINGS(
      makeRequest('http://test/api/broadcast/cancel-transfer-from-savings', {
        signedTx: VALID_TX,
        username: 'alice',
      })
    );
    expect(res1.status).toBe(403);
    expect(res2.status).toBe(403);
    expect(mockBroadcastTransaction).not.toHaveBeenCalled();
  });
});
