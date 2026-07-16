/**
 * Local persistence for login convenience (username / posting key on device only).
 * Never sent to the server.
 *
 * SECURITY RISK: when the user opts into "remember me", the posting private key
 * is written to `localStorage` so claim-reward signing works across reloads
 * (even when signed in with the active/owner key). `localStorage` is readable
 * by any JavaScript running in this origin, so XSS or device access exposes a
 * limited signing capability (posting authority only — not active/owner).
 *
 * Mitigations in place:
 *   - Opt-in only (default off); cleared on logout.
 *   - `Content-Security-Policy: frame-ancestors 'none'` + nosniff headers reduce
 *     injection/framing surface (see next.config.ts).
 *   - Posting authority is limited (cannot transfer funds; can vote/post/claim).
 *
 * Do NOT store active/owner keys in localStorage. If a stronger posture is
 * required, gate claim-reward behind a per-session re-prompt instead.
 */
export const REMEMBERED_USERNAME_KEY = 'wallet:rememberedUsername';
export const REMEMBERED_POSTING_KEY_KEY = 'wallet:rememberedPostingKey';

/** Normalize Steem account names for comparisons (matches LoginForm handling). */
export function normalizeSteemUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

/** Read remembered username from localStorage (client only). */
/** Remove saved posting key (e.g. after password rotation invalidates the old key). */
export function clearRememberedPostingKey(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REMEMBERED_POSTING_KEY_KEY);
  } catch {
    // ignore
  }
}

/** Remove saved username from this device (e.g. on logout). */
export function clearRememberedDeviceUsername(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  } catch {
    // ignore
  }
}

/** Clear all device-persisted login convenience data. */
export function clearRememberedDeviceAuth(): void {
  clearRememberedDeviceUsername();
  clearRememberedPostingKey();
}

export function getRememberedDeviceUsername(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (!saved?.trim()) return null;
    return normalizeSteemUsername(saved);
  } catch {
    return null;
  }
}

/**
 * Whether this device/session may use balance actions on the given profile URL.
 * True if the URL account is remembered on this device or the Redux session user matches.
 */
export function canManageBalanceForPageUrl(params: {
  urlUsername: string;
  loggedInUser: string | null;
  isAuthenticated: boolean;
}): boolean {
  const { urlUsername, loggedInUser, isAuthenticated } = params;
  if (!urlUsername?.trim()) return false;
  const nu = normalizeSteemUsername(urlUsername);
  const remembered = getRememberedDeviceUsername();
  if (remembered && remembered === nu) return true;
  if (isAuthenticated && loggedInUser && normalizeSteemUsername(loggedInUser) === nu) return true;
  return false;
}
