/**
 * Wallet Redux slice unit tests
 */

import { describe, it, expect } from 'vitest';
import walletReducer, {
  setBalance,
  setLoading,
  setError,
  clearWallet,
} from '@/lib/store/slices/wallet';

const initialState = {
  balance: null,
  loading: false,
  error: null,
};

const sampleBalance = {
  steem: '100.000 STEEM',
  sbd: '50.000 SBD',
  vests: '1000000.000000 VESTS',
};

describe('Wallet Slice', () => {
  it('returns the initial state for an unknown action', () => {
    expect(walletReducer(undefined, { type: 'unknown' })).toEqual(initialState);
  });

  it('setBalance stores the balance and clears loading/error', () => {
    const loadingState = { ...initialState, loading: true, error: 'previous' };
    const next = walletReducer(loadingState, setBalance(sampleBalance));

    expect(next.balance).toEqual(sampleBalance);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it('setLoading toggles the loading flag without touching balance/error', () => {
    const seeded = { ...initialState, balance: sampleBalance, error: 'x' };

    const loading = walletReducer(seeded, setLoading(true));
    expect(loading.loading).toBe(true);
    expect(loading.balance).toEqual(sampleBalance);
    expect(loading.error).toBe('x');

    const done = walletReducer(loading, setLoading(false));
    expect(done.loading).toBe(false);
  });

  it('setError stores the message and clears loading', () => {
    const loadingState = { ...initialState, loading: true };
    const next = walletReducer(loadingState, setError('boom'));

    expect(next.error).toBe('boom');
    expect(next.loading).toBe(false);
  });

  it('clearWallet resets balance, loading, and error', () => {
    const dirty = { balance: sampleBalance, loading: true, error: 'x' };
    expect(walletReducer(dirty, clearWallet())).toEqual(initialState);
  });
});
