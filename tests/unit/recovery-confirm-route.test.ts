import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/recovery/confirm/route';
import { NextRequest, NextResponse } from 'next/server';

// Mock the CSRF and rate limit middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock the SteemService requestAccountRecovery + conveyor config preflight
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    requestAccountRecovery: vi.fn().mockResolvedValue(undefined),
    validateConveyorConfig: vi.fn().mockReturnValue(null),
  },
}));

// Valid Steem public key (STM + exactly 50 base58 chars = 53 chars total)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const VALID_KEY_A = 'STM' + B58.slice(0, 50);
const VALID_KEY_B = 'STM' + B58.slice(1, 51);

const mockFindFirst = vi.fn();
let mockUpdateFn: ReturnType<typeof vi.fn>;

const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
  get update() {
    return mockUpdateFn;
  },
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

const VALID_CODE = '5bc350832943043e8a82';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/recovery/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
    body: JSON.stringify(body),
  });
}

function setupUpdateMocks(firstResult: unknown, secondResult?: unknown, thirdResult?: unknown) {
  const makeChain = (result: unknown) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.where = vi.fn().mockResolvedValue(result ?? undefined);
    chain.set = vi.fn().mockReturnValue({ where: chain.where });
    return chain;
  };

  const chain1 = makeChain(firstResult);
  const chain2 = makeChain(secondResult);
  const chain3 = makeChain(thirdResult);

  mockUpdateFn = vi.fn()
    .mockReturnValueOnce({ set: chain1.set })
    .mockReturnValueOnce({ set: chain2.set })
    .mockReturnValueOnce({ set: chain3.set });
}

describe('POST /api/recovery/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue(mockDb);
    // Default: findFirst returns a record matching old_owner_key
    mockFindFirst.mockResolvedValue({ id: 1, ownerKey: VALID_KEY_A });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validPayload = {
    code: VALID_CODE,
    account_name: 'alice',
    old_owner_key: VALID_KEY_A,
    new_owner_key: VALID_KEY_B,
    new_owner_authority: {
      weight_threshold: 1,
      account_auths: [] as [string, number][],
      key_auths: [[VALID_KEY_B, 1]] as [string, number][],
    },
  };

  it('returns ok for valid confirmed recovery (atomic CAS)', async () => {
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
    expect(SteemService.requestAccountRecovery).toHaveBeenCalledWith({
      account_to_recover: 'alice',
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[VALID_KEY_B, 1]],
      },
    });
  });

  it('short-circuits when CSRF verification fails', async () => {
    const { verifyCSRF } = await import('@/lib/middleware');
    vi.mocked(verifyCSRF).mockResolvedValueOnce(
      NextResponse.json({ error: 'Invalid CSRF' }, { status: 403 })
    );

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('short-circuits when rate limited', async () => {
    const { rateLimit } = await import('@/lib/middleware');
    vi.mocked(rateLimit).mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(429);
  });

  it('returns 400 for missing fields', async () => {
    const req = makeRequest({ code: VALID_CODE });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(data.error).toBe('Missing fields');
  });

  it('returns 400 for invalid code format', async () => {
    const req = makeRequest({ ...validPayload, code: 'not-hex!' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid confirmation code');
  });

  it('returns 400 for invalid old owner key format', async () => {
    const req = makeRequest({ ...validPayload, old_owner_key: 'bad-key' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid owner key format');
  });

  it('returns 400 for invalid new owner key format', async () => {
    const req = makeRequest({ ...validPayload, new_owner_key: 'bad-key' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid owner key format');
  });

  // ---- S3: new_owner_authority whitelist ----
  // The authority is signed on-chain by the server's CONVEYOR key; it must
  // be exactly the single-key authority derived from new_owner_key.

  it('S3: rejects key_auths that does not match new_owner_key (DB/chain divergence)', async () => {
    // The audit PoC: authority declares a DIFFERENT key than the one stored
    // in arecs — previously both were accepted and diverged silently.
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[VALID_KEY_A, 1]], // VALID_KEY_A != new_owner_key (VALID_KEY_B)
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid new owner authority');
  });

  it('S3: rejects non-empty account_auths (delegation to third-party accounts)', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [['attacker', 1]],
        key_auths: [[VALID_KEY_B, 1]],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid new owner authority');
  });

  it('S3: rejects weight_threshold other than 1', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 0, // the audit PoC value
        account_auths: [],
        key_auths: [[VALID_KEY_B, 1]],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid new owner authority');
  });

  it('S3: rejects key_auths weight other than 1', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[VALID_KEY_B, 0]],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid new owner authority');
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('S3: rejects object-map inner key_auths entry (serializer mismatch)', async () => {
    // `{0: STM…, 1: 1}` satisfies JS index reads but is dropped by
    // steem-js authorityMapEntries (requires Array.isArray(entry)).
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [{ 0: VALID_KEY_B, 1: 1 }],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid new owner authority');
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('S3: signs a server-constructed canonical authority (strips extra fields)', async () => {
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        ...validPayload.new_owner_authority,
        extra_field: 'must-not-reach-conveyor',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const forwarded = vi.mocked(SteemService.requestAccountRecovery).mock.calls[0]?.[0];
    expect(forwarded).toEqual({
      account_to_recover: 'alice',
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[VALID_KEY_B, 1]],
      },
    });
    expect(forwarded?.new_owner_authority).not.toHaveProperty('extra_field');
  });

  it('S3: rejects multiple key_auths entries', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [
          [VALID_KEY_B, 1],
          [VALID_KEY_A, 1],
        ],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('S3: rejects empty key_auths', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [],
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('S3: authority validation rejects BEFORE the CAS claim (no state touched)', async () => {
    const req = makeRequest({
      ...validPayload,
      new_owner_authority: {
        weight_threshold: 1,
        account_auths: [['attacker', 1]],
        key_auths: [[VALID_KEY_B, 1]],
      },
    });
    await POST(req);
    // The CAS update must never have run for a malformed authority.
    expect(mockUpdateFn).not.toHaveBeenCalled();
  });

  it('returns 400 when atomic update claims 0 rows (already processed / not found)', async () => {
    setupUpdateMocks({ affectedRows: 0 });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Recovery request not found or already processed');
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when old_owner_key does not match DB record (owner key mismatch)', async () => {
    setupUpdateMocks({ affectedRows: 1 });
    // DB has a different ownerKey
    mockFindFirst.mockResolvedValue({ id: 1, ownerKey: VALID_KEY_B });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Owner key mismatch');
    // Rollback: the record is reverted from 'processing' to 'confirmed' so the
    // user can retry. 3 update calls: CAS claim → findFirst → rollback.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
  });

  it('allows confirm when DB ownerKey is null (legacy records)', async () => {
    setupUpdateMocks({ affectedRows: 1 });
    mockFindFirst.mockResolvedValue({ id: 1, ownerKey: null });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
  });

  it('returns 503 when database is unavailable', async () => {
    mockGetDb.mockReturnValue(null);

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('Service unavailable');
  });

  it('returns 500 when requestAccountRecovery throws', async () => {
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.requestAccountRecovery).mockRejectedValueOnce(
      new Error('Kingdom unreachable')
    );

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.status).toBe('error');
  });

  it('rolls back to confirmed when requestAccountRecovery throws (retryable)', async () => {
    // Regression test: without rollback, a transient RPC error leaves the
    // record stuck in 'processing' forever — the user can never retry.
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.requestAccountRecovery).mockRejectedValueOnce(
      new Error('Kingdom unreachable')
    );

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(500);

    // CAS claim (1st) → rollback in catch (2nd). Success close never runs.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
  });

  it('rolls back to confirmed when conveyor config is missing (503 retryable)', async () => {
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    vi.mocked(SteemService.validateConveyorConfig).mockReturnValueOnce(
      'CONVEYOR_POSTING_WIF missing'
    );

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(503);
    // CAS claim (1st) → rollback (2nd). User can retry.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when database update throws', async () => {
    mockUpdateFn = vi.fn().mockImplementation(() => {
      throw new Error('Connection lost');
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.status).toBe('error');
  });
});
