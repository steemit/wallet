import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiClient } from '@/lib/steem/client';

describe('steem client recover helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getOwnerHistory calls owner-history endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, history: [] })));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const res = await apiClient.getOwnerHistory('Alice');
    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/query/owner-history?username=Alice');
  });

  it('initiateAccountRecoveryWithEmail posts with correct structure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' })));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const payload = { contact_email: 'a@example.com', account_name: 'alice', owner_key: 'STMxxxx' };
    const res = await apiClient.initiateAccountRecoveryWithEmail(payload);
    expect(res.status).toBe('ok');

    // Verify the call includes POST method, JSON content type, and body
    const call = fetchMock.mock.calls.at(0);
    expect(call).toBeDefined();
    const [url, opts] = call as unknown as [string, RequestInit];
    expect(url).toBe('/api/recovery/request');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toHaveProperty('Content-Type', 'application/json');
    // withCSRFHeader may or may not add X-CSRF-Token depending on cookie availability
    expect(opts.body).toBe(JSON.stringify(payload));
  });
});
