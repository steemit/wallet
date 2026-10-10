'use client';

import { createSelector } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { clearRememberedDeviceAuth } from '@/lib/auth/browser-storage';
import { logout as authLogout } from '@/lib/store/slices/auth';
import { apiClient } from '@/lib/steem/client';
import { keychainKey, wifKey, type SigningKey } from '@/lib/steem/signing-key';

interface UseAuthReturn {
  username: string | null;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

/**
 * Auth hooks for authenticated areas: `useAuth` exposes the current session
 * and how to end it (the login flow itself lives in `LoginForm`, the only
 * live entry point), and `useActiveSigningKey` exposes the active/owner
 * signing key for authority-checked operations.
 */
export function useAuth(): UseAuthReturn {
  const dispatch = useDispatch();
  const username = useSelector((state: RootState) => state.auth.username);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);

  const logout = async (): Promise<void> => {
    try {
      // Call server logout
      await apiClient.logout();
    } catch {
      // Ignore error
    } finally {
      dispatch(authLogout());
      clearRememberedDeviceAuth();
    }
  };

  return {
    username,
    isAuthenticated,
    logout,
  };
}

// Memoized (createSelector, not a plain inline selector): each returns a
// freshly-built SigningKey object, and useSelector's default reference-
// equality check would otherwise see a "new" value — and re-render every
// consumer — on every unrelated store update.
const selectActiveSigningKey = createSelector(
  [
    (state: RootState) => state.auth.authMethod,
    (state: RootState) => state.auth.username,
    (state: RootState) => state.auth.activeKey,
    (state: RootState) => state.auth.ownerKey,
  ],
  (authMethod, username, activeKey, ownerKey): SigningKey | null => {
    if (authMethod === 'keychain') {
      return username ? keychainKey(username, 'Active') : null;
    }
    const raw = activeKey || ownerKey;
    return raw ? wifKey(raw) : null;
  }
);

const selectPostingSigningKey = createSelector(
  [
    (state: RootState) => state.auth.authMethod,
    (state: RootState) => state.auth.username,
    (state: RootState) => state.auth.postingKey,
  ],
  (authMethod, username, postingKey): SigningKey | null => {
    if (authMethod === 'keychain') {
      return username ? keychainKey(username, 'Posting') : null;
    }
    return postingKey ? wifKey(postingKey) : null;
  }
);

/**
 * Signing key for operations requiring active (or owner) authority.
 * Do not use posting/memo keys for transfers / power / delegate / etc.
 *
 * A Keychain session has no raw key to return — every call site just hands
 * this straight to a `SteemSigner.sign<Op>` method, which dispatches a
 * `{ type: 'keychain' }` value to the browser extension instead of signing
 * locally (see `SteemSigner.signTransaction`).
 */
export function useActiveSigningKey(): SigningKey | null {
  return useSelector(selectActiveSigningKey);
}

/**
 * Signing key for operations requiring posting authority only
 * (claim_reward_balance today). See `useActiveSigningKey` for the Keychain
 * dispatch behavior.
 */
export function usePostingSigningKey(): SigningKey | null {
  return useSelector(selectPostingSigningKey);
}
