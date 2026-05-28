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

  it('initiateAccountRecoveryWithEmail posts to recovery/request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' })));
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const payload = { contact_email: 'a@example.com', account_name: 'alice', owner_key: 'STMxxxx' };
    const res = await apiClient.initiateAccountRecoveryWithEmail(payload);
    expect(res.status).toBe('ok');

    expect(fetchMock).toHaveBeenCalledWith('/api/recovery/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });
});

