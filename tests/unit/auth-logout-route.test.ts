import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Same middleware mock pattern as the login/challenge route tests.
const mockVerifyCSRF = vi.fn();
const mockRateLimit = vi.fn();
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

import { POST } from '@/app/api/auth/logout/route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/auth/logout', { method: 'POST' });
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyCSRF.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue(null);
  });

  it('returns the stateless no-op success shape', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true, message: 'Logged out successfully' });
  });

  it('runs verifyCSRF first', async () => {
    await POST(makeRequest());
    expect(mockVerifyCSRF).toHaveBeenCalledTimes(1);
  });

  it('passes the CSRF rejection through (403)', async () => {
    const { NextResponse } = await import('next/server');
    mockVerifyCSRF.mockResolvedValueOnce(
      NextResponse.json({ error: 'CSRF token missing' }, { status: 403 })
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    // Rate limiting must not run once CSRF already blocked.
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('applies the auth-scope rate limit (auth_logout, 10/min)', async () => {
    await POST(makeRequest());
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), 'auth_logout', {
      maxRequests: 10,
      windowSeconds: 60,
    });
  });

  it('passes the rate-limit rejection through (429)', async () => {
    const { NextResponse } = await import('next/server');
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
  });
});
