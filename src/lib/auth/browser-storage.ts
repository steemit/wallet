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
 * RISK ACCEPTANCE (architecture owner ruling, 2026-08-16):
 *   This exposure is ACCEPTED as-is. Rationale:
 *   - The primary vector (XSS) is mitigated by the strict CSP (script-src
 *     'self' + SRI, no unsafe-inline — see next.config.ts); no XSS sink is
 *     known to exist in this codebase.
 *   - Posting authority cannot transfer funds; worst case is reputation/abuse
 *     (impersonation posts, votes), not loss of funds.
 *   - Residual vectors (malicious browser extensions, shared devices) cannot
 *     be eliminated by application code in any web wallet.
 *   - The convenience (one-click claim-rewards after WIF login) is deemed
 *     worth the residual risk for now.
 *
 * FUTURE PATH: if users would accept a PIN prompt, migrate to WebCrypto
 * PBKDF2 + AES-GCM encryption of the posting key (PIN-derived key). Do NOT
 * implement silently-gated encryption — the value comes only from a real
 * per-session user secret. Until then, keep this as plaintext + opt-in.
 *
 * Do NOT store active/owner keys in localStorage under any scheme.
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
