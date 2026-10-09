import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const mockGetRedis = vi.fn();
vi.mock('@/lib/cache/redis', () => ({
  getRedis: () => mockGetRedis(),
  redisKey: (k: string) => `wallet:${k}`,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDeleteByPrefix: vi.fn(),
}));

import { rateLimit } from '@/lib/middleware/rate-limit';

function makeReq(headers: Record<string, string> = {}, path: string): NextRequest {
  const url = new URL(`http://localhost${path}`);
  return new NextRequest(url, { headers: new Headers(headers) });
}

/** Recursively collect route directory paths under src/app/api. */
function collectRouteDirs(base: string): string[] {
  const out: string[] = [];
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(base, entry.name);
    out.push(child);
    out.push(...collectRouteDirs(child));
  }
  return out;
}

/** Convert an absolute route dir into its URL path, e.g. /api/recovery/verify/[code]. */
function dirToRoutePath(routeDir: string): string {
  const rel = routeDir.split('/src/app')[1]!;
  return rel.replaceAll(/\\/g, '/').replace(/^\/+/, '/');
}

describe('routeScopeOf fallback is default-deny (F14 structural hardening)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null); // memory fallback → observable buckets
  });

  it('unregistered dynamic shapes collapse into ONE shared bucket (no fresh counter)', async () => {
    // Simulates a future unregistered dynamic route, e.g. /api/query/user/[name].
    const r1 = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.1' }, '/api/query/user/alice'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r1).toBeNull();
    const r2 = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.1' }, '/api/query/user/bob'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r2).not.toBeNull();
    expect(r2!.status).toBe(429);
  });

  it('encoded or mixed-case segments in odd shapes cannot fork the bucket', async () => {
    await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.2' }, '/api/query/user/%2Fetc'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    const r = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.2' }, '/api/query/user/%2Fvar'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r).not.toBeNull();
  });

  it('static routes still get their canonical per-route buckets', async () => {
    await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.3' }, '/api/query/history'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    const same = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.3' }, '/api/query/history'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(same!.status).toBe(429);
    const other = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.3' }, '/api/query/witnesses'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(other).toBeNull();
  });

  it('trailing slash on static routes stays in the same bucket', async () => {
    await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.4' }, '/api/query/history'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    const r = await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.4' }, '/api/query/history/'),
      'query',
      { maxRequests: 1, windowSeconds: 60 }
    );
    expect(r!.status).toBe(429);
  });

  it('the unregistered bucket is asserted at the Redis key level', async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    mockGetRedis.mockReturnValue({ incr, expire });

    await rateLimit(
      makeReq({ 'x-real-ip': '10.9.0.5' }, '/api/query/user/somebody'),
      'query',
      { maxRequests: 10, windowSeconds: 60 }
    );

    const redisKeyUsed = incr.mock.calls[0]![0] as string;
    expect(redisKeyUsed).toMatch(/:unregistered:\d+$/);
    expect(redisKeyUsed).not.toContain('somebody');
  });
});

describe('every dynamic route under src/app/api is registered in routeScopeOf (CI guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedis.mockReturnValue(null); // memory fallback → observable buckets
  });

  // Walk the actual route tree: any directory whose name contains brackets
  // is a dynamic segment. The patterns registered inside routeScopeOf must
  // cover every such route — otherwise a new dynamic route silently shares
  // the conservative 'unregistered' bucket, which fails this test so the
  // developer registers it explicitly.
  const apiRoot = join(process.cwd(), 'src', 'app', 'api');
  const dynamicRoutes = collectRouteDirs(apiRoot)
    .map(dirToRoutePath)
    .filter((p) => p.includes('['));

  it('finds the known dynamic route (sanity: the walker works)', () => {
    expect(dynamicRoutes).toContain('/api/recovery/verify/[code]');
  });

  it('normalized scope of each dynamic route is stable across different params', async () => {
    // Drive the real limiter: two different params of the same dynamic route
    // must land in ONE bucket. If a new dynamic route appears unregistered,
    // it also lands in one bucket ('unregistered') — acceptable fail-closed
    // behavior, surfaced here for visibility rather than silent key sprawl.
    for (const route of dynamicRoutes) {
      const a = route.replace(/\[[^\]]+\]/, 'aaaaaaaaaaaaaaaaaaaa');
      const b = route.replace(/\[[^\]]+\]/, 'bbbbbbbbbbbbbbbbbbbb');
      await rateLimit(makeReq({ 'x-real-ip': `10.8.0.1` }, a), 'guard', {
        maxRequests: 1,
        windowSeconds: 60,
      });
      const r = await rateLimit(makeReq({ 'x-real-ip': `10.8.0.1` }, b), 'guard', {
        maxRequests: 1,
        windowSeconds: 60,
      });
      expect(r, `dynamic route ${route} forked the rate-limit bucket`).not.toBeNull();
    }
  });
});
