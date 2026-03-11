/**
 * Auth hooks unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useAuth, useRequireAuth, usePrivateKey } from '@/hooks/use-auth';
import authReducer from '@/lib/store/slices/auth';

// Mock SteemSigner and apiClient - factory function to avoid hoisting issues
vi.mock('@/lib/steem/client', () => {
  const mockGetChallenge = vi.fn();
  const mockLogin = vi.fn();
  const mockLogout = vi.fn();
  const mockIsValidPrivateKey = vi.fn();
  const mockPrivateKeyToPublicKey = vi.fn();
  const mockSignChallenge = vi.fn();

  return {
    SteemSigner: {
      isValidPrivateKey: mockIsValidPrivateKey,
      privateKeyToPublicKey: mockPrivateKeyToPublicKey,
      signChallenge: mockSignChallenge,
    },
    apiClient: {
      getChallenge: mockGetChallenge,
      login: mockLogin,
      logout: mockLogout,
    },
    __mockExports: {
      mockGetChallenge,
      mockLogin,
      mockLogout,
      mockIsValidPrivateKey,
      mockPrivateKeyToPublicKey,
      mockSignChallenge,
    },
  };
});

// Import the mocked functions
import { SteemSigner, apiClient, __mockExports } from '@/lib/steem/client';

// @ts-expect-error - Accessing mock exports
const mockGetChallenge = __mockExports?.mockGetChallenge || vi.fn();
// @ts-expect-error - Accessing mock exports
const mockLogin = __mockExports?.mockLogin || vi.fn();
// @ts-expect-error - Accessing mock exports
const mockLogout = __mockExports?.mockLogout || vi.fn();
// @ts-expect-error - Accessing mock exports
const mockIsValidPrivateKey = __mockExports?.mockIsValidPrivateKey || vi.fn();
// @ts-expect-error - Accessing mock exports
const mockPrivateKeyToPublicKey = __mockExports?.mockPrivateKeyToPublicKey || vi.fn();
// @ts-expect-error - Accessing mock exports
const mockSignChallenge = __mockExports?.mockSignChallenge || vi.fn();

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: '',
  },
  writable: true,
});

describe('useAuth Hook', () => {
  let mockStore: ReturnType<typeof configureStore>;

  beforeEach(() => {
    mockStore = configureStore({
      reducer: {
        auth: authReducer,
      },
    });

    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={mockStore}>{children}</Provider>
  );

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      mockIsValidPrivateKey.mockReturnValue(true);
      mockPrivateKeyToPublicKey.mockReturnValue('STMPublicKey...');
      mockSignChallenge.mockReturnValue('signed-challenge');
      mockGetChallenge.mockResolvedValue({ challenge: 'test-challenge' });
      mockLogin.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', '5JPrivateKey...');
      });

      expect(loginResult).toBe(true);
      expect(mockStore.getState().auth.username).toBe('testuser');
      expect(mockStore.getState().auth.isAuthenticated).toBe(true);
    });

    it('should fail login with invalid private key', async () => {
      mockIsValidPrivateKey.mockReturnValue(false);

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', 'invalid-key');
      });

      expect(loginResult).toBe(false);
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });

    it('should fail login when server rejects credentials', async () => {
      mockIsValidPrivateKey.mockReturnValue(true);
      mockPrivateKeyToPublicKey.mockReturnValue('STMPublicKey...');
      mockSignChallenge.mockReturnValue('signed-challenge');
      mockGetChallenge.mockResolvedValue({ challenge: 'test-challenge' });
      mockLogin.mockResolvedValue({ success: false, error: 'Invalid credentials' });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', '5JPrivateKey...');
      });

      expect(loginResult).toBe(false);
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });

    it('should handle network errors during login', async () => {
      mockIsValidPrivateKey.mockReturnValue(true);
      mockGetChallenge.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', '5JPrivateKey...');
      });

      expect(loginResult).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear auth state on logout', async () => {
      // Set up logged in state
      mockStore.dispatch({
        type: 'auth/setCredentials',
        payload: {
          username: 'testuser',
          privateKey: 'privatekey',
          publicKey: 'publickey',
        },
      });

      mockLogout.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.logout();
      });

      expect(mockStore.getState().auth.username).toBeNull();
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
      expect(mockStore.getState().auth.privateKey).toBeNull();
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

      mockLogout.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await act(async () => {
        await result.current.logout();
      });

      // Should still clear local state
      expect(mockStore.getState().auth.username).toBeNull();
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });
  });

  describe('usePrivateKey', () => {
    it('should return null when not authenticated', () => {
      const { result } = renderHook(() => usePrivateKey(), { wrapper });

      expect(result.current).toBeNull();
    });

    it('should return private key when authenticated', () => {
      mockStore.dispatch({
        type: 'auth/setCredentials',
        payload: {
          username: 'testuser',
          privateKey: '5JPrivateKey...',
          publicKey: 'STMPublicKey...',
        },
      });

      const { result } = renderHook(() => usePrivateKey(), { wrapper });

      expect(result.current).toBe('5JPrivateKey...');
    });
  });
});

describe('useRequireAuth Hook', () => {
  let mockStore: ReturnType<typeof configureStore>;

  beforeEach(() => {
    mockStore = configureStore({
      reducer: {
        auth: authReducer,
      },
    });

    window.location.href = '';
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={mockStore}>{children}</Provider>
  );

  it('should redirect to login when not authenticated', async () => {
    renderHook(() => useRequireAuth(), { wrapper });

    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });

  it('should not redirect when authenticated', () => {
    mockStore.dispatch({
      type: 'auth/setCredentials',
      payload: {
        username: 'testuser',
        privateKey: 'privatekey',
        publicKey: 'publickey',
      },
    });

    window.location.href = '';

    renderHook(() => useRequireAuth(), { wrapper });

    // Should not redirect
    expect(window.location.href).toBe('');
  });
});
