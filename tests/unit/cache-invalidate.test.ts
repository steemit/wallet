import { describe, it, expect } from 'vitest';
import { setCacheInvalidateHeader } from '@/lib/middleware/cache-invalidate';
import { NextResponse } from 'next/server';

describe('setCacheInvalidateHeader', () => {
  it('sets the header for a valid Steem account name', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, 'alice');
    expect(res.headers.get('X-Cache-Invalidate')).toBe('alice');
  });

  it('normalizes to lowercase and trims', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, '  Alice  ');
    expect(res.headers.get('X-Cache-Invalidate')).toBe('alice');
  });

  it('accepts names with dots and dashes (sub-accounts)', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, 'user.sub-account');
    expect(res.headers.get('X-Cache-Invalidate')).toBe('user.sub-account');
  });

  it('omits the header for input containing CRLF (header injection)', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, 'alice\r\nX-Injected: evil');
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });

  it('omits the header for non-string input', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, 123);
    setCacheInvalidateHeader(res, null);
    setCacheInvalidateHeader(res, undefined);
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });

  it('omits the header for an empty string', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, '   ');
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });

  it('omits the header for a name exceeding 16 chars', () => {
    const res = NextResponse.json({});
    setCacheInvalidateHeader(res, 'this-name-is-way-too-long');
    expect(res.headers.get('X-Cache-Invalidate')).toBeNull();
  });
});
