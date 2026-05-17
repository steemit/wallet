/**
 * Wallet Redux slice unit tests
 *
 * Only covers reducers with side effects beyond a single field assignment:
 *   - setBalance: writes balance AND clears loading + error
 *   - setError:   writes error AND clears loading
 *   - clearWallet: full reset
 */

import { describe, it, expect } from 'vitest';
import walletReducer, {
  setBalance,
  setError,
  clearWallet,
} from '@/lib/store/slices/wallet';

const sampleBalance = {
  steem: '100.000 STEEM',
  sbd: '50.000 SBD',
  vests: '1000000.000000 VESTS',
};

describe('Wallet Slice', () => {
  it('setBalance stores the balance and clears loading/error in one shot', () => {
    const next = walletReducer(
      { balance: null, loading: true, error: 'previous' },
      setBalance(sampleBalance),
    );
    expect(next).toEqual({ balance: sampleBalance, loading: false, error: null });
  });

  it('setError stores the message and clears loading', () => {
    const next = walletReducer(
      { balance: null, loading: true, error: null },
      setError('boom'),
    );
    expect(next.error).toBe('boom');
    expect(next.loading).toBe(false);
  });

  it('clearWallet resets every field to its initial value', () => {
    const next = walletReducer(
      { balance: sampleBalance, loading: true, error: 'x' },
      clearWallet(),
    );
    expect(next).toEqual({ balance: null, loading: false, error: null });
  });
});
