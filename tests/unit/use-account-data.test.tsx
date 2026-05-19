/**
 * use-account-data hook unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useAccountData } from '@/hooks/use-account-data';
import authReducer from '@/lib/store/slices/auth';
import { clientCache } from '@/lib/cache/client-cache';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(data: unknown): Response {
  return {
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as unknown as Response;
}

describe('useAccountData Hook', () => {
  let mockStore: ReturnType<typeof configureStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    clientCache.clear();
    mockStore = configureStore({
      reducer: {
        auth: authReducer,
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={mockStore}>{children}</Provider>
  );

  describe('without authenticated user', () => {
    it('should return null data and not call API when no username', async () => {
      const { result } = renderHook(() => useAccountData(), { wrapper });

      expect(result.current.data).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('with authenticated user', () => {
    beforeEach(() => {
      mockStore.dispatch({
        type: 'auth/setCredentials',
        payload: {
          username: 'alice',
          privateKey: 'privatekey',
          publicKey: 'publickey',
        },
      });
    });

    it('should fetch account data on mount', async () => {
      const mockAccount = {
        name: 'alice',
        balance: { amount: '1000', precision: 3, nai: '@@000000021' },
        sbd_balance: { amount: '500', precision: 3, nai: '@@000000013' },
        vesting_shares: { amount: '1000000', precision: 6, nai: '@@000000037' },
      };

      mockFetch.mockResolvedValueOnce(jsonResponse({ accounts: [mockAccount] }));

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockAccount);
    });

    it('should handle API error', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ accounts: [], error: 'Account not found' })
      );

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Account not found');
      expect(result.current.data).toBeNull();
    });

    it('should handle empty accounts array', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ accounts: [] }));

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to fetch account data');
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to fetch account data');
    });

    it('should refetch data when refetch is called', async () => {
      const mockAccount1 = { name: 'alice', balance: { amount: '1000', precision: 3, nai: '@@000000021' } };
      const mockAccount2 = { name: 'alice', balance: { amount: '2000', precision: 3, nai: '@@000000021' } };

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ accounts: [mockAccount1] }))
        .mockResolvedValueOnce(jsonResponse({ accounts: [mockAccount2] }));

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockAccount1);

      // Refetch
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockAccount2);
      });
    });

    it('should clear error on successful refetch', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(jsonResponse({ accounts: [{ name: 'alice' }] }));

      const { result } = renderHook(() => useAccountData(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to fetch account data');

      // Refetch with success
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('');
      expect(result.current.data).not.toBeNull();
    });
  });

  describe('refetch behavior with no username', () => {
    it('should not call API when refetch is called with no username', async () => {
      // Don't set any username
      const { result } = renderHook(() => useAccountData(), { wrapper });

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
