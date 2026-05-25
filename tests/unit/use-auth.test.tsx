/**
 * Auth hooks unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useAuth, useRequireAuth, usePrivateKey } from '@/hooks/use-auth';
import authReducer from '@/lib/store/slices/auth';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';

// Mock SteemSigner and apiClient - factory function to avoid hoisting issues
vi.mock('@/lib/steem/client', () => {
  const mockGetChallenge = vi.fn();
  const mockLogin = vi.fn();
  const mockLogout = vi.fn();
  const mockGetAccounts = vi.fn();
  const mockIsValidPrivateKey = vi.fn();
  const mockPrivateKeyToPublicKey = vi.fn();
  const mockSignChallenge = vi.fn();

  return {
    SteemSigner: {
      isValidPrivateKey: mockIsValidPrivateKey,
      privateKeyToPublicKey: mockPrivateKeyToPublicKey,
      signChallenge: mockSignChallenge,
      derivePrivateKeyFromPassword: vi.fn(),
    },
    apiClient: {
      getChallenge: mockGetChallenge,
      login: mockLogin,
      logout: mockLogout,
      getAccounts: mockGetAccounts,
    },
  };
});

// Import the mocked functions
import { SteemSigner, apiClient } from '@/lib/steem/client';

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    href: '',
  },
  writable: true,
});

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

  describe('login', () => {
    it('should successfully login with valid WIF key', async () => {
      (SteemSigner.isValidPrivateKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (SteemSigner.privateKeyToPublicKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue('STMPublicKey...');
      (SteemSigner.signChallenge as unknown as ReturnType<typeof vi.fn>).mockReturnValue('signed-challenge');
      (apiClient.getAccounts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        accounts: [
          {
            name: 'testuser',
            owner: { key_auths: [['STMOwner', 1]] },
            active: { key_auths: [['STMPublicKey...', 1]] },
            posting: { key_auths: [['STMPosting', 1]] },
            memo_key: 'STMMemo',
          },
        ],
      });
      (apiClient.getChallenge as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ challenge: 'test-challenge' });
      (apiClient.login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

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
      (SteemSigner.isValidPrivateKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (apiClient.getAccounts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        accounts: [
          {
            name: 'testuser',
            owner: { key_auths: [] },
            active: { key_auths: [] },
            posting: { key_auths: [] },
            memo_key: '',
          },
        ],
      });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', 'invalid-key');
      });

      expect(loginResult).toBe(false);
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });

    it('should fail login when server rejects credentials', async () => {
      (SteemSigner.isValidPrivateKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (SteemSigner.privateKeyToPublicKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue('STMPublicKey...');
      (SteemSigner.signChallenge as unknown as ReturnType<typeof vi.fn>).mockReturnValue('signed-challenge');
      (apiClient.getAccounts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        accounts: [
          {
            name: 'testuser',
            owner: { key_auths: [['STMOwner', 1]] },
            active: { key_auths: [['STMPublicKey...', 1]] },
            posting: { key_auths: [['STMPosting', 1]] },
            memo_key: 'STMMemo',
          },
        ],
      });
      (apiClient.getChallenge as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ challenge: 'test-challenge' });
      (apiClient.login as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Invalid credentials' });

      const { result } = renderHook(() => useAuth(), { wrapper });

      let loginResult: boolean | undefined;
      await act(async () => {
        loginResult = await result.current.login('testuser', '5JPrivateKey...');
      });

      expect(loginResult).toBe(false);
      expect(mockStore.getState().auth.isAuthenticated).toBe(false);
    });

    it('should handle network errors during login', async () => {
      (SteemSigner.isValidPrivateKey as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (apiClient.getAccounts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        accounts: [
          {
            name: 'testuser',
            owner: { key_auths: [['STMOwner', 1]] },
            active: { key_auths: [['STMPublicKey...', 1]] },
            posting: { key_auths: [['STMPosting', 1]] },
            memo_key: 'STMMemo',
          },
        ],
      });
      (apiClient.getChallenge as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

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
