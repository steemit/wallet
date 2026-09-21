'use client';

import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { clearRememberedDeviceAuth } from '@/lib/auth/browser-storage';
import { logout as authLogout } from '@/lib/store/slices/auth';
import { apiClient } from '@/lib/steem/client';

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

/**
 * Private key that can sign operations requiring active (or owner) authority.
 * Do not use posting/memo keys for transfers / power / delegate / etc.
 */
export function useActiveSigningKey(): string | null {
  return useSelector((state: RootState) => state.auth.activeKey || state.auth.ownerKey || null);
}
