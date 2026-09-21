/**
 * Auth hooks unit tests.
 *
 * Covers the live surface of `useAuth` (session state + logout). The login
 * flow is owned by `LoginForm` and is tested in login-form-reauth.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useAuth } from '@/hooks/use-auth';
import authReducer from '@/lib/store/slices/auth';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';

// Mock apiClient - factory function to avoid hoisting issues
vi.mock('@/lib/steem/client', () => {
  const mockLogout = vi.fn();

  return {
    SteemSigner: {
      isValidPrivateKey: vi.fn(),
      privateKeyToPublicKey: vi.fn(),
      signChallenge: vi.fn(),
      derivePrivateKeyFromPassword: vi.fn(),
    },
    apiClient: {
      logout: mockLogout,
    },
  };
});

// Import the mocked functions
import { apiClient } from '@/lib/steem/client';

describe('useAuth Hook', () => {
  const createTestStore = () =>
    configureStore({
      reducer: {
        auth: authReducer,
      },
    });
  type TestStore = ReturnType<typeof createTestStore>;

  let mockStore: TestStore;

  beforeEach(() => {
    mockStore = createTestStore();
    localStorage.clear();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={mockStore}>{children}</Provider>
  );

  describe('logout', () => {
    it('should clear auth state on logout', async () => {
      localStorage.setItem(REMEMBERED_USERNAME_KEY, 'testuser');
      localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5Jtest');

      mockStore.dispatch({
        type: 'auth/setCredentials',
        payload: {
          username: 'testuser',
          privateKey: 'privatekey',
          publicKey: 'publickey',
        },
      });

      (apiClient.logout as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.logout();
      });

      expect(mockStore.getState().auth.username).toBeNull();
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
      expect(mockStore.getState().auth.privateKey).toBeNull();
      expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBeNull();
      expect(localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBeNull();
    });

    it('should clear auth state even if server logout fails', async () => {
      // Set up logged in state
      mockStore.dispatch({
        type: 'auth/setCredentials',
        payload: {
          username: 'testuser',
          privateKey: 'privatekey',
          publicKey: 'publickey',
        },
      });

      (apiClient.logout as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.logout();
      });

      // Should still clear local state
      expect(mockStore.getState().auth.username).toBeNull();
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });
  });
});
