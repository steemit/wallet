import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/recovery/request/route';
import { NextRequest } from 'next/server';

// Mock the CSRF and rate limit middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
  // Proxy-aware IP resolution used for the forensic remote_ip field.
  getClientIP: vi.fn().mockReturnValue('9.9.9.9'),
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

  // Valid Steem public key (STM + 50 base58 chars = 53 chars total)
  const VALID_OWNER_KEY = 'STM123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqr';

  it('returns ok for valid new request', async () => {
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
  });

  it('S6: forensic remote_ip comes from the proxy-aware getClientIP, not raw XFF', async () => {
    // The request carries a SPOOFED x-forwarded-for; the recorded IP must
    // come from the (mocked) proxy-aware resolver instead.
    const req = new NextRequest('http://localhost/api/recovery/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-token',
        'x-forwarded-for': '1.2.3.4, 6.6.6.6',
      },
      body: JSON.stringify({
        contact_email: 'test@example.com',
        account_name: 'alice',
        owner_key: VALID_OWNER_KEY,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const inserted = mockInsertValues.mock.calls[0]![0] as { remoteIp: string | null };
    expect(inserted.remoteIp).toBe('9.9.9.9'); // from getClientIP mock
    expect(inserted.remoteIp).not.toContain('1.2.3.4');
  });

  it('returns duplicate for existing open request', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 1, status: 'open' });
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: VALID_OWNER_KEY,
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

  it('returns 400 for invalid owner_key format', async () => {
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: 'not-a-valid-key',
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(data.error).toBe('Invalid owner key format');
    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid email format', async () => {
    const req = makeRequest({
      contact_email: 'not-an-email',
      account_name: 'alice',
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(data.error).toBe('Invalid email format');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid account_name format', async () => {
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'a',  // too short
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(data.error).toBe('Invalid account name format');
    expect(res.status).toBe(400);
  });

  it('trims account_name whitespace', async () => {
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: '  alice  ',
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('ok');
    // Verify insert was called with trimmed name
    const insertCall = mockInsertValues.mock.calls[0];
    expect(insertCall).toBeDefined();
    const inserted = insertCall![0] as { accountName: string };
    expect(inserted.accountName).toBe('alice');
  });

  it('normalizes email to lowercase for duplicate check', async () => {
    const req = makeRequest({
      contact_email: 'TEST@EXAMPLE.COM',
      account_name: 'alice',
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(mockFindFirst).toHaveBeenCalledOnce();
  });

  it('returns 503 when database is unavailable', async () => {
    mockGetDb.mockReturnValue(null);
    const req = makeRequest({
      contact_email: 'test@example.com',
      account_name: 'alice',
      owner_key: VALID_OWNER_KEY,
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
      owner_key: VALID_OWNER_KEY,
    });
    const res = await POST(req);
    const data = await res.json();
    expect(data.status).toBe('error');
    expect(res.status).toBe(500);
  });

  it.each([
    '10.1.2.3',            // RFC1918 10/8 (ALB VPC range when realip drifts)
    '127.0.0.1',           // loopback
    '192.168.1.1',         // RFC1918 192.168/16
    '172.16.0.1',          // RFC1918 172.16/12
    '172.31.255.254',      // RFC1918 172.16/12 upper edge
    '::1',                 // IPv6 loopback
    'fd00::1',             // IPv6 ULA
    'fc00::1',             // IPv6 ULA (currently reserved)
  ])('S6: warns when remote_ip is infrastructure (%s) — realip drift made visible', async (ip) => {
    const { getClientIP } = await import('@/lib/middleware');
    vi.mocked(getClientIP).mockReturnValueOnce(ip);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const req = makeRequest({
        contact_email: 'test@example.com',
        account_name: 'alice',
        owner_key: VALID_OWNER_KEY,
      });
      const res = await POST(req);
      // Self-check is warn-only: the recovery flow itself must proceed.
      expect(res.status).toBe(200);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('looks like infrastructure'),
        expect.objectContaining({ remoteIp: ip })
      );
      const inserted = mockInsertValues.mock.calls[0]![0] as { remoteIp: string | null };
      expect(inserted.remoteIp).toBe(ip);
    } finally {
      warn.mockRestore();
    }
  });

  it('S6: no infra warning for a public client IP', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const req = makeRequest({
        contact_email: 'test@example.com',
        account_name: 'alice',
        owner_key: VALID_OWNER_KEY,
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
