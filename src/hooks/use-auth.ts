'use client';

import { useDispatch, useSelector } from 'react-redux';
import { useEffect } from 'react';
import type { RootState } from '@/lib/store';
import { setCredentials, logout as authLogout } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';

interface UseAuthReturn {
  username: string | null;
  isAuthenticated: boolean;
  login: (username: string, privateKey: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const dispatch = useDispatch();
  const username = useSelector((state: RootState) => state.auth.username);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);

  const login = async (usernameInput: string, privateKeyInput: string): Promise<boolean> => {
    try {
      // Validate private key format
      if (!SteemSigner.isValidPrivateKey(privateKeyInput)) {
        return false;
      }

      // Get public key from private key
      const publicKey = SteemSigner.privateKeyToPublicKey(privateKeyInput);

      // Get challenge from server
      const { challenge } = await apiClient.getChallenge(usernameInput);

      // Sign the challenge
      const signedChallenge = SteemSigner.signChallenge(challenge, privateKeyInput);

      // Login to server
      const response = await apiClient.login(usernameInput, signedChallenge, publicKey);

      if (!response.success) {
        return false;
      }

      // Store credentials in Redux (memory only)
      dispatch(
        setCredentials({
          username: usernameInput,
          privateKey: privateKeyInput,
          publicKey,
        })
      );

      return true;
    } catch {
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      // Call server logout
      await apiClient.logout();
    } catch {
      // Ignore error
    } finally {
      // Clear local state
      dispatch(authLogout());
    }
  };

  return {
    username,
    isAuthenticated,
    login,
    logout,
  };
}

/**
 * Hook to require authentication
 * Redirects to login page if not authenticated
 */
export function useRequireAuth(): { username: string | null; isAuthenticated: boolean } {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isAuthenticated && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [auth.isAuthenticated]);

  return auth;
}

/**
 * Hook to get the current private key (for signing transactions)
 * This should only be used in client components
 */
export function usePrivateKey(): string | null {
  return useSelector((state: RootState) => state.auth.privateKey);
}
