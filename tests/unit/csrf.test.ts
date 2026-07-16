import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateCSRFToken,
  isValidCSRFToken,
  verifyCSRF,
  setCSRFToken,
} from '@/lib/middleware/csrf';
import { NextRequest, NextResponse } from 'next/server';

describe('CSRF token generation and verification', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.CSRF_SECRET;

  beforeEach(() => {
    process.env.CSRF_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalSecret !== undefined) process.env.CSRF_SECRET = originalSecret;
    else delete process.env.CSRF_SECRET;
  });

  it('generates a token with the expected two-part shape', () => {
    const token = generateCSRFToken();
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it('round-trips: a generated token verifies as valid', () => {
    const token = generateCSRFToken();
    expect(isValidCSRFToken(token)).toBe(true);
  });

  it('rejects a tampered MAC', () => {
    const token = generateCSRFToken();
    const parts = token.split('.');
    // Flip the last char of the MAC.
    const tamperedMac = parts[1]!.slice(0, -1) + (parts[1]!.endsWith('A') ? 'B' : 'A');
    expect(isValidCSRFToken(`${parts[0]}.${tamperedMac}`)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    process.env.CSRF_SECRET = 'secret-A';
    const token = generateCSRFToken();
    process.env.CSRF_SECRET = 'secret-B';
    expect(isValidCSRFToken(token)).toBe(false);
  });

  it('rejects malformed tokens (no dot, empty parts)', () => {
    expect(isValidCSRFToken('nodothere')).toBe(false);
    expect(isValidCSRFToken('.')).toBe(false);
    expect(isValidCSRFToken('abc.')).toBe(false);
    expect(isValidCSRFToken('.abc')).toBe(false);
  });

  it('rejects a token with a non-numeric timestamp', () => {
    const tsB64 = Buffer.from('not-a-number', 'utf-8').toString('base64url');
    const mac = Buffer.from('fakemac').toString('base64url');
    expect(isValidCSRFToken(`${tsB64}.${mac}`)).toBe(false);
  });
});

describe('verifyCSRF', () => {
  beforeEach(() => {
    process.env.CSRF_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
  });

  function makeRequest(method: string, cookieToken?: string, headerToken?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (cookieToken) headers['cookie'] = `csrf_token=${cookieToken}`;
    if (headerToken) headers['X-CSRF-Token'] = headerToken;
    return new NextRequest('http://localhost/api/test', { method, headers });
  }

  it('returns null (allows) safe methods', async () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      const req = makeRequest(m);
      expect(await verifyCSRF(req)).toBeNull();
    }
  });

  it('returns 403 when the token is missing', async () => {
    const req = makeRequest('POST');
    const res = await verifyCSRF(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 when header and cookie do not match', async () => {
    const req = makeRequest('POST', 'cookie-val', 'different-header-val');
    const res = await verifyCSRF(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns null when a valid matching token is present', async () => {
    const token = generateCSRFToken();
    const req = makeRequest('POST', token, token);
    expect(await verifyCSRF(req)).toBeNull();
  });

  it('returns 403 when tokens match but are cryptographically invalid', async () => {
    const req = makeRequest('POST', 'garbage.matching', 'garbage.matching');
    const res = await verifyCSRF(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});

describe('setCSRFToken', () => {
  it('sets a csrf_token cookie on the response', () => {
    const res = NextResponse.json({});
    setCSRFToken(res);
    const cookie = res.cookies.get('csrf_token');
    expect(cookie).toBeDefined();
    expect(cookie?.value).toContain('.');
  });
});
