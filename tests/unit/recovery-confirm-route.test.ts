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
let lastUpdateChains: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> }[] = [];

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

/**
 * The REAL drizzle-orm mysql2 contract for an update without .returning():
 * MySql2PreparedQuery.execute() resolves to the raw mysql2 query result,
 * the tuple [ResultSetHeader, FieldPacket[]]. The old mocks resolved
 * `{ affectedRows: 1 }` — a shape the real dependency never returns — which
 * masked the CAS result-shape bug (see src/lib/db/affected-rows.ts).
 */
const MYSQL_RESULT_HEADER = { affectedRows: 1, insertId: 0 };
const MYSQL_RESULT_FIELDS: unknown[] = [];
function mysqlUpdateResult(affectedRows: number): unknown {
  return [{ ...MYSQL_RESULT_HEADER, affectedRows }, MYSQL_RESULT_FIELDS];
}

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/recovery/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
    body: JSON.stringify(body),
  });
}

/**
 * Queue one drizzle update result per expected update call, in order. The
 * chains are kept in `lastUpdateChains` so tests can assert which values
 * each CAS set. The queue is padded to at least 3 chains (matching the
 * historical helper) so success-path tests that only pin the claim result
 * still have a chain for the close/rollback updates.
 */
function setupUpdateMocks(...results: unknown[]) {
  const padded = [...results];
  while (padded.length < 3) padded.push(undefined);
  lastUpdateChains = padded.map((result) => {
    const chain: { set: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> } = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(result ?? undefined),
    };
    chain.set.mockReturnValue({ where: chain.where });
    return chain;
  });

  mockUpdateFn = vi.fn();
  for (const chain of lastUpdateChains) {
    mockUpdateFn.mockReturnValueOnce({ set: chain.set });
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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
    setupUpdateMocks(mysqlUpdateResult(1));

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
    setupUpdateMocks(mysqlUpdateResult(1));

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
    setupUpdateMocks(mysqlUpdateResult(0));

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Recovery request not found or already processed');
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when old_owner_key does not match DB record (owner key mismatch)', async () => {
    setupUpdateMocks(mysqlUpdateResult(1));
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
    setupUpdateMocks(mysqlUpdateResult(1));
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
    setupUpdateMocks(mysqlUpdateResult(1));

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
    setupUpdateMocks(mysqlUpdateResult(1));

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
    setupUpdateMocks(mysqlUpdateResult(1));

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

  // ---- CAS result-shape regression (drizzle mysql2 contract) ----
  // The CAS used to read `(result as { affectedRows }).affectedRows`, which
  // is undefined on the real driver tuple [ResultSetHeader, FieldPacket[]] —
  // step 2 has NEVER worked against a real MySQL. These tests pin the real
  // contract so a shape regression cannot hide behind mocks again.

  it('CAS: succeeds reading the real drizzle tuple shape [ResultSetHeader, FieldPacket[]]', async () => {
    const { SteemService } = await import('@/lib/steem/server');

    // Exact mysql2 driver shape: array with the header at index 0 and the
    // field-packet array at index 1. affectedRows lives on the header only.
    setupUpdateMocks([
      Object.assign(Object.create(null), {
        affectedRows: 1,
        insertId: 0,
        info: 'Rows matched: 1  Changed: 1  Warnings: 0',
      }),
      [],
    ]);

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(SteemService.requestAccountRecovery).toHaveBeenCalledTimes(1);
  });

  it('CAS: treats an unreadable (non-tuple) result shape as an error and rolls back', async () => {
    // This is the shape the OLD unit mocks used ({ affectedRows: 1 }) — a
    // shape the real dependency never returns. The route must not mistake it
    // for a CAS miss (400, row left stuck in 'processing'): it rolls the
    // claim back and fails with 500.
    setupUpdateMocks({ affectedRows: 1 });

    const { SteemService } = await import('@/lib/steem/server');
    const req = makeRequest(validPayload);
    const res = await POST(req);

    expect(res.status).toBe(500);
    // CAS claim (1st) → rollback (2nd). requestAccountRecovery never runs.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
    expect(SteemService.requestAccountRecovery).not.toHaveBeenCalled();
  });

  it('CAS: undefined-shaped update result rolls back and returns 500 (not a silent 400)', async () => {
    setupUpdateMocks(undefined);

    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(500);
    // CAS claim (1st) → rollback (2nd) so the record is not stuck.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
  });

  // ---- B-4: code TTL (24h) enforcement ----
  // The claim CAS is TTL-bounded; a missed claim on a stale confirmed (or
  // long-crashed processing) record lazily persists terminal 'expired'.

  it('TTL: claim miss on a confirmed record confirmed 25h ago → 400 expired + lazy-expire CAS', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    setupUpdateMocks(mysqlUpdateResult(0), mysqlUpdateResult(1));
    mockFindFirst
      .mockResolvedValueOnce({
        id: 1,
        status: 'confirmed',
        updatedAt: new Date(Date.now() - 25 * HOUR),
      })
      .mockResolvedValue({ id: 1, ownerKey: VALID_KEY_A });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('expired');
    expect(data.error).toContain('expired');
    // Update 1: TTL-bounded claim (miss). Update 2: lazy expire CAS.
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
    expect(lastUpdateChains[1]!.set).toHaveBeenCalledWith({ status: 'expired' });
    expect(SteemService.requestAccountRecovery).not.toHaveBeenCalled();
  });

  it('TTL: a processing record stuck 25h (crashed long ago) → 400 expired, not reclaimed', async () => {
    setupUpdateMocks(mysqlUpdateResult(0), mysqlUpdateResult(1));
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      status: 'processing',
      updatedAt: new Date(Date.now() - 25 * HOUR),
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('expired');
    expect(lastUpdateChains[1]!.set).toHaveBeenCalledWith({ status: 'expired' });
  });

  it('TTL: record already terminal expired → 400 expired without another update', async () => {
    setupUpdateMocks(mysqlUpdateResult(0));
    mockFindFirst.mockResolvedValueOnce({ id: 1, status: 'expired', updatedAt: new Date() });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('expired');
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
  });

  it('claim miss on a fresh confirmed record (race) → generic 400, row untouched', async () => {
    setupUpdateMocks(mysqlUpdateResult(0));
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      status: 'confirmed',
      updatedAt: new Date(),
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Recovery request not found or already processed');
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
  });

  // ---- B-4: stuck-processing self-heal (10-minute bound) ----

  it('stuck processing (15 min) → reclaim to confirmed, re-claim, and complete the flow (200)', async () => {
    const { SteemService } = await import('@/lib/steem/server');
    setupUpdateMocks(
      mysqlUpdateResult(0), // 1: claim (miss — row is stuck 'processing')
      mysqlUpdateResult(1), // 2: reclaim processing → confirmed
      mysqlUpdateResult(1), // 3: re-claim confirmed → processing
      mysqlUpdateResult(1) // 4: close → success
    );
    mockFindFirst
      .mockResolvedValueOnce({
        id: 1,
        status: 'processing',
        updatedAt: new Date(Date.now() - 15 * MINUTE),
      })
      .mockResolvedValue({ id: 1, ownerKey: VALID_KEY_A });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const req = makeRequest(validPayload);
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe('ok');
      // reclaim sets 'confirmed', retry claim sets 'processing'
      expect(lastUpdateChains[1]!.set).toHaveBeenCalledWith({ status: 'confirmed' });
      expect(lastUpdateChains[2]!.set).toHaveBeenCalledWith({ status: 'processing' });
      expect(SteemService.requestAccountRecovery).toHaveBeenCalledTimes(1);
      expect(mockUpdateFn).toHaveBeenCalledTimes(4);
    } finally {
      warn.mockRestore();
    }
  });

  it('processing within the stuck threshold (2 min) → 400 processing, no reclaim', async () => {
    setupUpdateMocks(mysqlUpdateResult(0));
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      status: 'processing',
      updatedAt: new Date(Date.now() - 2 * MINUTE),
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('processing');
    expect(data.error).toContain('currently being processed');
    expect(mockUpdateFn).toHaveBeenCalledTimes(1);
  });

  it('lost the reclaim race (another request progressed the row) → 400 processing', async () => {
    setupUpdateMocks(mysqlUpdateResult(0), mysqlUpdateResult(0));
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      status: 'processing',
      updatedAt: new Date(Date.now() - 15 * MINUTE),
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.record_status).toBe('processing');
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
  });
});
