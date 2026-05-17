/**
 * Store factory unit tests
 *
 * Locks in the SSR-isolation invariant: makeStore must return a fresh store
 * on every call so that concurrent server requests cannot share state.
 */

import { describe, it, expect } from 'vitest';
import { makeStore } from '@/lib/store';
import { setCredentials } from '@/lib/store/slices/auth';

describe('makeStore', () => {
  it('returns an isolated store instance per call', () => {
    expect(makeStore()).not.toBe(makeStore());
  });

  it('does not share dispatched state between instances', () => {
    const a = makeStore();
    const b = makeStore();

    a.dispatch(setCredentials({ username: 'alice' }));

    expect(a.getState().auth.username).toBe('alice');
    expect(b.getState().auth.username).toBeNull();
  });
});
