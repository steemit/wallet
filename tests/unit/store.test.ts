/**
 * Store factory unit tests
 *
 * Locks in the SSR-isolation invariant: makeStore must return a fresh store
 * on every call so that concurrent server requests cannot share state.
 *
 * Also tests the devTools sanitizers which redact private key fields so they
 * never appear in the Redux DevTools extension.
 */

import { describe, it, expect } from 'vitest';
import { makeStore, devStateSanitizer, devActionSanitizer } from '@/lib/store';
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

describe('devStateSanitizer', () => {
  const baseState = {
    auth: {
      username: 'alice',
      activeKey: 'REAL_KEY',
      postingKey: 'POST_KEY',
      ownerKey: null,
      memoKey: null,
      privateKey: null,
      isAuthenticated: true,
      publicKey: null,
    },
    wallet: {},
    ui: {},
  };

  it('redacts non-null key fields', () => {
    const sanitized = devStateSanitizer(baseState) as typeof baseState;
    expect(sanitized.auth.activeKey).toBe('[REDACTED]');
    expect(sanitized.auth.postingKey).toBe('[REDACTED]');
  });

  it('leaves null key fields unchanged', () => {
    const sanitized = devStateSanitizer(baseState) as typeof baseState;
    expect(sanitized.auth.ownerKey).toBeNull();
    expect(sanitized.auth.memoKey).toBeNull();
    expect(sanitized.auth.privateKey).toBeNull();
  });

  it('preserves non-key fields', () => {
    const sanitized = devStateSanitizer(baseState) as typeof baseState;
    expect(sanitized.auth.username).toBe('alice');
    expect(sanitized.auth.isAuthenticated).toBe(true);
  });
});

describe('devActionSanitizer', () => {
  it('redacts key fields in auth/setCredentials payload', () => {
    const action = {
      type: 'auth/setCredentials',
      payload: { username: 'alice', activeKey: 'REAL_KEY', postingKey: null },
    };
    const sanitized = devActionSanitizer(action) as typeof action;
    expect(sanitized.payload.activeKey).toBe('[REDACTED]');
    expect(sanitized.payload.postingKey).toBeNull(); // null left alone
    expect(sanitized.payload.username).toBe('alice');
  });

  it('passes through unrelated actions unchanged', () => {
    const action = { type: 'wallet/setSomething', payload: { value: 42 } };
    expect(devActionSanitizer(action)).toBe(action);
  });
});
