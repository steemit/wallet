import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/recovery/request/route';
import { NextRequest } from 'next/server';

// Mock the CSRF and rate limit middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
}));

// Mock the Drizzle db module
const mockFindFirst = vi.fn();
const mockInsertValues = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
const mockDb = {
  query: {
    arecs: {
      findFirst: mockFindFirst,
    },
  },
  insert: mockInsert,
};
const mockGetDb = vi.fn().mockReturnValue(mockDb);

vi.mock('@/lib/db', () => ({
  getDb: () => vi.mocked(mockGetDb)(),
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/recovery/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-token' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/recovery/request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockReturnValue(mockDb);
    mockFindFirst.mockResolvedValue(undefined);
    mockInsertValues.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok for valid new request', async () => {
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: 'STM6xxx',
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('returns duplicate for existing open request', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 1, status: 'open' });
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: 'STM6xxx',
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('duplicate');
    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 for missing fields', async () => {
    const req = makeRequest({ contact_email: 'test@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.status).toBe('error');
  });

  it('returns 503 when database is unavailable', async () => {
    mockGetDb.mockReturnValue(null);
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: 'STM6xxx',
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(res.status).toBe(503);
  });

  it('returns 500 when database throws', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('Connection lost'));
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: 'STM6xxx',
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(res.status).toBe(500);
  });
});
