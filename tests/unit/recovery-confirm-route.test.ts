import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/recovery/confirm/route';
import { NextRequest } from 'next/server';

// Mock the CSRF and rate limit middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock the Drizzle db module
const mockFindFirst = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({
  set: (...args: unknown[]) => ({
    where: mockUpdateWhere,
  }),
});
mockUpdate.mockImplementation(() => {
  return {
    set: mockUpdateSet.mockReturnValue({
      where: mockUpdateWhere,
    }),
  };
});
const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
  update: mockUpdate,
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

const VALID_OWNER_KEY = 'STM6xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const VALID_CODE = '5bc350832943043e8a82';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/recovery/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/recovery/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue(mockDb);
    mockFindFirst.mockResolvedValue(undefined);
    mockUpdateSet.mockResolvedValue(undefined);
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validPayload = {
    code: VALID_CODE,
    account_name: 'alice',
    old_owner_key: VALID_OWNER_KEY,
    new_owner_key: 'STM7yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    new_owner_authority: {
      weight_threshold: 1,
      account_auths: [] as [string, number][],
      key_auths: [['STM7yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy', 1]] as [string, number][],
    },
  };

  it('returns ok for valid confirmed recovery', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      accountName: 'alice',
      status: 'confirmed',
    });

    const req = makeRequest(validPayload);
    const res = await POST(req);
    const data = await res.json();

    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed' })
    );
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

  it('returns 404 for non-existent code', async () => {
    mockFindFirst.mockResolvedValueOnce(undefined);
    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Confirmation code not found');
  });

  it('returns 400 when recovery not yet approved (status=open)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      accountName: 'alice',
      status: 'open',
    });
    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Recovery request has not been approved');
  });

  it('returns 400 when account name mismatch', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 1,
      accountName: 'bob',
      status: 'confirmed',
    });
    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Account name mismatch');
  });

  it('returns 503 when database is unavailable', async () => {
    mockGetDb.mockReturnValue(null);
    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('Service unavailable');
  });

  it('returns 500 when database throws', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('Connection lost'));
    const req = makeRequest(validPayload);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.status).toBe('error');
  });
});
