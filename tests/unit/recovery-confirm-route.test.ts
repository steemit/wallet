import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/recovery/confirm/route';
import { NextRequest } from 'next/server';

// Mock the CSRF and rate limit middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock the SteemService requestAccountRecovery
vi.mock('@/lib/steem/server', () => ({
  SteemService: {
    requestAccountRecovery: vi.fn().mockResolvedValue(undefined),
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

function setupUpdateMocks(firstResult: unknown, secondResult?: unknown) {
  const chain1: Record<string, ReturnType<typeof vi.fn>> = {};
  chain1.where = vi.fn().mockResolvedValue(firstResult);
  chain1.set = vi.fn().mockReturnValue({ where: chain1.where });

  const chain2: Record<string, ReturnType<typeof vi.fn>> = {};
  chain2.where = vi.fn().mockResolvedValue(secondResult ?? undefined);
  chain2.set = vi.fn().mockReturnValue({ where: chain2.where });

  mockUpdateFn = vi.fn()
    .mockReturnValueOnce({ set: chain1.set })
    .mockReturnValueOnce({ set: chain2.set });
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

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledTimes(2);
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
