'use client';

import { useDispatch, useSelector } from 'react-redux';
import { useEffect } from 'react';
import type { RootState } from '@/lib/store';
import { setCredentials, logout as authLogout } from '@/lib/store/slices/auth';
import { SteemSigner, apiClient } from '@/lib/steem/client';

interface UseAuthReturn {
  username: string | null;
  isAuthenticated: boolean;
  login: (username: string, secret: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const dispatch = useDispatch();
  const username = useSelector((state: RootState) => state.auth.username);
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);

  const login = async (usernameInput: string, secretInput: string): Promise<boolean> => {
    try {
      const usernameTrimmed = usernameInput.trim();
      const rawSecret = secretInput.trim();

      if (!usernameTrimmed || !rawSecret) {
        return false;
      }

      // Fetch account to resolve keys/roles
      const accountsResp = await apiClient.getAccounts([usernameTrimmed], { fresh: true });
      const account = accountsResp.accounts?.[0];
      if (!account) {
        return false;
      }

      const accountOwnerKey = account.owner?.key_auths?.[0]?.[0];
      const accountActiveKey = account.active?.key_auths?.[0]?.[0];
      const accountPostingKey = account.posting?.key_auths?.[0]?.[0];
      const accountMemoKey = account.memo_key;

      const matchesPub = (priv: string, expectedPub?: string | null) => {
        if (!expectedPub) return false;
        try {
          return SteemSigner.privateKeyToPublicKey(priv) === expectedPub;
        } catch {
          return false;
        }
      };

      let ownerKey: string | null = null;
      let activeKey: string | null = null;
      let postingKey: string | null = null;
      let memoKey: string | null = null;
      let primaryPrivateKey: string | null = null;

      if (SteemSigner.isValidPrivateKey(rawSecret)) {
        if (matchesPub(rawSecret, accountOwnerKey)) {
          ownerKey = rawSecret;
          primaryPrivateKey = ownerKey;
        } else if (matchesPub(rawSecret, accountActiveKey)) {
          activeKey = rawSecret;
          primaryPrivateKey = activeKey;
        } else if (matchesPub(rawSecret, accountPostingKey)) {
          postingKey = rawSecret;
          primaryPrivateKey = postingKey;
        } else if (matchesPub(rawSecret, accountMemoKey)) {
          memoKey = rawSecret;
          primaryPrivateKey = memoKey;
        } else {
          return false;
        }
      } else {
        try {
          const derivedOwner = SteemSigner.derivePrivateKeyFromPassword(usernameTrimmed, rawSecret, 'owner');
          const derivedActive = SteemSigner.derivePrivateKeyFromPassword(usernameTrimmed, rawSecret, 'active');
          const derivedPosting = SteemSigner.derivePrivateKeyFromPassword(usernameTrimmed, rawSecret, 'posting');
          const derivedMemo = SteemSigner.derivePrivateKeyFromPassword(usernameTrimmed, rawSecret, 'memo');

          if (matchesPub(derivedOwner, accountOwnerKey)) ownerKey = derivedOwner;
          if (matchesPub(derivedActive, accountActiveKey)) activeKey = derivedActive;
          if (matchesPub(derivedPosting, accountPostingKey)) postingKey = derivedPosting;
          if (matchesPub(derivedMemo, accountMemoKey)) memoKey = derivedMemo;
        } catch {
          return false;
        }

        if (activeKey) {
          primaryPrivateKey = activeKey;
        } else if (ownerKey) {
          primaryPrivateKey = ownerKey;
        } else if (postingKey) {
          primaryPrivateKey = postingKey;
        } else if (memoKey) {
          primaryPrivateKey = memoKey;
        } else {
          return false;
        }
      }

      if (!primaryPrivateKey) {
        return false;
      }

      const publicKey = SteemSigner.privateKeyToPublicKey(primaryPrivateKey);

      // Get challenge from server
      const { challenge } = await apiClient.getChallenge(usernameTrimmed);

      // Sign the challenge
      const signedChallenge = SteemSigner.signChallenge(challenge, primaryPrivateKey);

      // Login to server
      const response = await apiClient.login(usernameTrimmed, signedChallenge, publicKey);

      if (!response.success) {
        return false;
      }

      // Store credentials in Redux (memory only)
      dispatch(
        setCredentials({
          username: usernameTrimmed,
          ownerKey,
          activeKey,
          postingKey,
          memoKey,
          privateKey: primaryPrivateKey,
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
  return useSelector((state: RootState) => state.auth.activeKey || state.auth.privateKey);
}

/**
 * Private key that can sign operations requiring active (or owner) authority.
 * Do not use posting/memo keys for transfers / power / delegate / etc.
 */
export function useActiveSigningKey(): string | null {
  return useSelector((state: RootState) => state.auth.activeKey || state.auth.ownerKey || null);
}
