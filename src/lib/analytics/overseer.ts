'use client';

/**
 * Client helpers for overseer frontend tracking (legacy ServerApiClient).
 *
 * Events POST to /api/analytics/overseer (CSRF + rate limit); the server
 * reconstructs the legacy payload and relays `overseer.collect` to jussi.
 * The csrf_token cookie is issued by the proxy middleware on every document
 * response, so it is available to anonymous visitors from the first page load.
 * Failures are swallowed — analytics must never break wallet actions.
 */

import type { OverseerRouteTag, OverseerUserAction, RouteTagParams, UserActionParams } from './overseer-payload';

const TRACKING_ID_KEY = 'wallet_tracking_id';

function csrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  const token = match?.[1] ? decodeURIComponent(match[1]) : null;
  return token ? { 'X-CSRF-Token': token } : {};
}

/**
 * Anonymous visitor id (legacy `session.uid`: 13 random bytes as hex).
 * Persisted in localStorage because this app has no server session cookie.
 */
export function getTrackingId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = localStorage.getItem(TRACKING_ID_KEY);
    if (existing && /^[a-f0-9]{8,32}$/.test(existing)) return existing;
    const bytes = new Uint8Array(13);
    crypto.getRandomValues(bytes);
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    localStorage.setItem(TRACKING_ID_KEY, hex);
    return hex;
  } catch {
    return '';
  }
}

async function postOverseer(body: unknown): Promise<void> {
  try {
    await fetch('/api/analytics/overseer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Swallow — never surface analytics errors to the user.
  }
}

export function recordRouteTag(
  tag: OverseerRouteTag,
  params: RouteTagParams | undefined,
  isLogin = false
): void {
  const trackingId = getTrackingId();
  if (!trackingId) return;
  void postOverseer({
    kind: 'route',
    tag,
    trackingId,
    isLogin,
    ...(params ? { params } : {}),
  });
}

export function userActionRecord(action: OverseerUserAction, params: UserActionParams): void {
  void postOverseer({ kind: 'action', action, params });
}
