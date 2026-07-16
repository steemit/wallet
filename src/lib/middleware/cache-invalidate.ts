import { NextResponse } from 'next/server';

// Steem account names: lowercase, 3-16 chars, [a-z0-9.-], may contain a single
// dot for sub-accounts. We do not allow CR/LF or any header-breaking byte.
const STEEM_NAME_RE = /^[a-z0-9.-]{1,16}$/;

/**
 * Reflect a sanitized account name into the X-Cache-Invalidate header. The
 * value comes from the request body, so it must be validated to prevent header
 * injection. If the value is not a plausible Steem account name the header is
 * omitted (cache invalidation is best-effort).
 */
export function setCacheInvalidateHeader(
  response: NextResponse,
  username: unknown
): void {
  if (typeof username !== 'string') return;
  const trimmed = username.trim().toLowerCase();
  if (!trimmed || !STEEM_NAME_RE.test(trimmed)) return;
  response.headers.set('X-Cache-Invalidate', trimmed);
}
