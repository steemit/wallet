import { describe, expect, it, vi } from 'vitest';
import { cachedFetch } from '@/lib/cache/client-fetch';

describe('cachedFetch(noStore)', () => {
  it('uses fetch cache=no-store', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    // @ts-expect-error override global fetch
    globalThis.fetch = fetchMock;

    const res = await cachedFetch<{ ok: boolean }>('/x', { staleMs: 1, maxAgeMs: 2, noStore: true });
    expect(res.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/x', { cache: 'no-store' });
  });
});

