/**
 * Local persistence for login convenience (username / posting key on device only).
 * Never sent to the server.
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
