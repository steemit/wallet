import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/broadcast/recover-account/route';
import { NextRequest } from 'next/server';

// Mock middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock SteemService
const mockGetOwnerHistory = vi.fn();
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    validateTransactionShape: vi.fn().mockReturnValue(true),
    broadcastTransaction: vi.fn().mockResolvedValue({ id: 'tx123' }),
    getOwnerHistory: (...args: unknown[]) => mockGetOwnerHistory(...args),
  },
}));

// Mock steem-js
vi.mock('@steemit/steem-js', () => ({
  steem: {
    auth: {
      normalizeTransactionForBroadcast: vi.fn((tx: unknown) => tx),
      // verifyTransaction now does real crypto verification (v1.0.20+).
      // Default to true (valid signature); individual tests can override.
      verifyTransaction: vi.fn().mockReturnValue(true),
    },
  },
}));

// Valid Steem public key (STM + exactly 50 base58 chars = 53 chars total)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const VALID_KEY_A = 'STM' + B58.slice(0, 50);
const VALID_KEY_B = 'STM' + B58.slice(1, 51);

const mockFindFirst = vi.fn();
const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/broadcast/recover-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
    body: JSON.stringify(body),
  });
}

function makeSignedTx(overrides?: Partial<{
  account_to_recover: string;
  newKey: string;
  recentKey: string;
}>) {
  const newKey = overrides?.newKey ?? VALID_KEY_B;
  const recentKey = overrides?.recentKey ?? VALID_KEY_A;
  return {
    operations: [
      [
        'recover_account',
        {
          account_to_recover: overrides?.account_to_recover ?? 'alice',
          new_owner_authority: {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[newKey, 1]],
          },
          recent_owner_authority: {
            weight_threshold: 1,
            account_auths: [],
            key_auths: [[recentKey, 1]],
          },
        },
      ],
    ],
    signatures: ['sig123'],
  };
}

describe('POST /api/broadcast/recover-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue(mockDb);
    // Default: DB has a matching closed record
    mockFindFirst.mockResolvedValue({
      id: 1,
      status: 'closed',
      newOwnerKey: VALID_KEY_B,
    });
    // Default: owner history contains VALID_KEY_A (the recentKey in makeSignedTx)
    mockGetOwnerHistory.mockResolvedValue([
      { previous_owner_authority: { key_auths: [[VALID_KEY_A, 1]] } },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('broadcasts valid recover_account transaction', async () => {
    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(res.status).toBe(200);
  });

  it('returns 400 when signedTx is missing', async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing signed transaction');
  });

  it('returns 400 when transaction shape validation fails', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.validateTransactionShape).mockReturnValueOnce(false);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid transaction format');
  });

  it('returns 400 when signature does not match recent_owner_authority', async () => {
    const { steem } = await import('@steemit/steem-js');
    vi.mocked(steem.auth.verifyTransaction).mockReturnValueOnce(false);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not match recent_owner_authority');
  });

  it('returns 400 when recent_owner_authority is not in chain owner history', async () => {
    // The claimed recent key (VALID_KEY_A) is NOT in the chain's owner history
    // (which only has VALID_KEY_B). This is the self-satisfiable-check fix:
    // the attacker cannot just put their own key in the op body.
    mockGetOwnerHistory.mockResolvedValue([
      { previous_owner_authority: { key_auths: [[VALID_KEY_B, 1]] } },
    ]);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not match any historical owner key');
    // Must not reach broadcast.
    const { SteemService } = await import('@/lib/steem/server');
    expect(SteemService.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when chain owner history is empty', async () => {
    mockGetOwnerHistory.mockResolvedValue([]);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not match any historical owner key');
  });

  it('returns 503 when owner history lookup fails', async () => {
    mockGetOwnerHistory.mockRejectedValue(new Error('RPC down'));

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('owner history lookup failed');
  });

  it('returns 400 when first operation is not recover_account', async () => {
    const badTx = {
      operations: [['account_update', {}]],
      signatures: ['sig'],
    };
    const req = makeRequest({ signedTx: badTx });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('expected recover_account');
  });

  it('returns 400 when operation body is invalid', async () => {
    const badTx = {
      operations: [['recover_account', { account_to_recover: 'alice' }]],
      signatures: ['sig'],
    };
    const req = makeRequest({ signedTx: badTx });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid recover_account operation body');
  });

  it('returns 400 when new_owner_authority has no key_auth', async () => {
    const badTx = {
      operations: [
        [
          'recover_account',
          {
            account_to_recover: 'alice',
            new_owner_authority: {
              weight_threshold: 1,
              account_auths: [],
              key_auths: [],
            },
            recent_owner_authority: {
              weight_threshold: 1,
              account_auths: [],
              key_auths: [[VALID_KEY_A, 1]],
            },
          },
        ],
      ],
      signatures: ['sig'],
    };
    const req = makeRequest({ signedTx: badTx });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid new_owner_authority: missing key_auth');
  });

  it('returns 400 when DB has no closed recovery record', async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('No confirmed recovery request');
  });

  it('returns 400 when DB record status is not closed', async () => {
    mockFindFirst.mockResolvedValue({ id: 1, status: 'processing', newOwnerKey: VALID_KEY_B });

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when newOwnerKey does not match', async () => {
    mockFindFirst.mockResolvedValue({ id: 1, status: 'closed', newOwnerKey: VALID_KEY_A });

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not match');
  });

  it('returns 400 when newOwnerKey is null in DB', async () => {
    mockFindFirst.mockResolvedValue({ id: 1, status: 'closed', newOwnerKey: null });

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('does not match');
  });

  it('returns 503 when DB is unavailable (fail-closed, never broadcasts)', async () => {
    // Security gate: when MySQL is down the route must refuse to broadcast
    // rather than skipping the recovery-record cross-check.
    mockGetDb.mockReturnValue(null);

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('Service unavailable');

    // Must not have reached broadcast.
    const { SteemService } = await import('@/lib/steem/server');
    expect(SteemService.broadcastTransaction).not.toHaveBeenCalled();
  });

  it('returns 500 when broadcastTransaction throws', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.broadcastTransaction).mockRejectedValueOnce(
      new Error('Network error')
    );

    const req = makeRequest({ signedTx: makeSignedTx() });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Failed to broadcast transaction');
  });
});
