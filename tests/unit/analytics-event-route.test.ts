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
});
