import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock middleware
vi.mock('@/lib/middleware', () => ({
  verifyCSRF: vi.fn().mockResolvedValue(null),
  rateLimit: vi.fn().mockResolvedValue(null),
  getClientIP: vi.fn().mockReturnValue('unknown'),
}));

import { POST } from '@/app/api/analytics/event/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 't' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analytics/event (S7 bounds)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('accepts a normal event', async () => {
    const res = await POST(makeRequest({ event: 'page_view', properties: { page: '/x' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(console.log).toHaveBeenCalledOnce();
  });

  it('rejects an event name longer than 64 chars', async () => {
    const res = await POST(makeRequest({ event: 'a'.repeat(65) }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects event names with unexpected characters', async () => {
    const res = await POST(makeRequest({ event: 'bad event\nname' }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects properties over 2048 bytes', async () => {
    const res = await POST(makeRequest({ event: 'page_view', properties: { blob: 'x'.repeat(3000) } }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects properties with more than 16 keys', async () => {
    const properties: Record<string, number> = {};
    for (let i = 0; i < 17; i++) properties[`k${i}`] = i;
    const res = await POST(makeRequest({ event: 'page_view', properties }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects a missing/non-string event name', async () => {
    const res = await POST(makeRequest({ event: 123 }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects a timestamp longer than 32 chars', async () => {
    const res = await POST(makeRequest({ event: 'page_view', timestamp: 'x'.repeat(33) }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects a non-string timestamp', async () => {
    const res = await POST(makeRequest({ event: 'page_view', timestamp: 1234567890 }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects an unparseable timestamp', async () => {
    const res = await POST(makeRequest({ event: 'page_view', timestamp: 'not a date' }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('accepts a valid ISO timestamp and logs it through', async () => {
    const res = await POST(makeRequest({
      event: 'page_view',
      timestamp: '2026-09-06T12:00:00.000Z',
    }));
    expect(res.status).toBe(200);
    expect(console.log).toHaveBeenCalledOnce();
  });

  it('rejects non-object properties (string payload)', async () => {
    const res = await POST(makeRequest({ event: 'page_view', properties: 'x'.repeat(10) }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });

  it('rejects null properties', async () => {
    const res = await POST(makeRequest({ event: 'page_view', properties: null }));
    expect(res.status).toBe(400);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('POST /api/analytics/event (S6: single client-IP convention)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs the IP from the proxy-aware getClientIP, not raw x-forwarded-for', async () => {
    const { getClientIP } = await import('@/lib/middleware');
    vi.mocked(getClientIP).mockReturnValueOnce('203.0.113.9');

    const req = new NextRequest('http://localhost/api/analytics/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 't',
        // Client-supplied spoofed XFF must NOT reach the log line.
        'x-forwarded-for': '1.2.3.4, 6.6.6.6',
      },
      body: JSON.stringify({ event: 'page_view' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const logged = JSON.parse(vi.mocked(console.log).mock.calls[0]![0] as string);
    expect(logged.ip).toBe('203.0.113.9');
    expect(logged.ip).not.toContain('1.2.3.4');
    expect(logged.ip).not.toBe('unknown');
  });
});
