import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRateLimit = vi.fn();
const mockVerifyCSRF = vi.fn();
vi.mock('@/lib/middleware', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  verifyCSRF: (...args: unknown[]) => mockVerifyCSRF(...args),
}));

import { POST } from '@/app/api/recovery/request/route';

describe('POST /api/recovery/request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue(null);
    mockVerifyCSRF.mockResolvedValue(null);
  });

  it('returns 400 when fields missing', async () => {
    const req = new Request('http://test/api/recovery/request', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('returns ok when fields provided', async () => {
    const req = new Request('http://test/api/recovery/request', {
      method: 'POST',
      body: JSON.stringify({
        contact_email: 'a@example.com',
        account_name: 'alice',
        owner_key: 'STMxxxx',
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('short-circuits when rate limited', async () => {
    mockRateLimit.mockResolvedValue(new Response('rl', { status: 429 }));
    const req = new Request('http://test/api/recovery/request', {
      method: 'POST',
      body: JSON.stringify({
        contact_email: 'a@example.com',
        account_name: 'alice',
        owner_key: 'STMxxxx',
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(429);
  });

  it('short-circuits when CSRF fails', async () => {
    mockVerifyCSRF.mockResolvedValue(new Response('csrf', { status: 403 }));
    const req = new Request('http://test/api/recovery/request', {
      method: 'POST',
      body: JSON.stringify({
        contact_email: 'a@example.com',
        account_name: 'alice',
        owner_key: 'STMxxxx',
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });
});

