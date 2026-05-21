/**
 * Store factory unit tests
 *
 * Locks in the SSR-isolation invariant: makeStore must return a fresh store
 * on every call so that concurrent server requests cannot share state.
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
  const baseAuth = {
    username: 'alice',
    isAuthenticated: true,
    ownerKey: 'owner-wif',
    activeKey: 'active-wif',
    postingKey: 'posting-wif',
    memoKey: 'memo-wif',
    privateKey: 'private-wif',
    challenge: null,
    sessionExpiry: null,
  };

  it('replaces all key fields with [REDACTED]', () => {
    const state = { auth: baseAuth, wallet: {}, ui: {} };
    const result = devStateSanitizer(state) as typeof state;
    expect(result.auth.ownerKey).toBe('[REDACTED]');
    expect(result.auth.activeKey).toBe('[REDACTED]');
    expect(result.auth.postingKey).toBe('[REDACTED]');
    expect(result.auth.memoKey).toBe('[REDACTED]');
    expect(result.auth.privateKey).toBe('[REDACTED]');
  });

  it('preserves non-key auth fields and other slices', () => {
    const state = { auth: baseAuth, wallet: { balance: '1.000 STEEM' }, ui: { theme: 'dark' } };
    const result = devStateSanitizer(state) as typeof state;
    expect(result.auth.username).toBe('alice');
    expect(result.auth.isAuthenticated).toBe(true);
    expect(result.wallet).toEqual({ balance: '1.000 STEEM' });
    expect(result.ui).toEqual({ theme: 'dark' });
  });

  it('skips null key fields without throwing', () => {
    const state = { auth: { ...baseAuth, activeKey: null, postingKey: null }, wallet: {}, ui: {} };
    const result = devStateSanitizer(state) as typeof state;
    expect(result.auth.activeKey).toBeNull();
    expect(result.auth.postingKey).toBeNull();
    expect(result.auth.ownerKey).toBe('[REDACTED]');
  });
});

describe('devActionSanitizer', () => {
  it('redacts key fields in auth/setCredentials payload', () => {
    const action = {
      type: 'auth/setCredentials',
      payload: { username: 'alice', activeKey: 'active-wif', postingKey: 'posting-wif' },
    };
    const result = devActionSanitizer(action) as typeof action;
    expect(result.payload.activeKey).toBe('[REDACTED]');
    expect(result.payload.postingKey).toBe('[REDACTED]');
    expect(result.payload.username).toBe('alice');
  });

  it('passes through unrelated action types unchanged', () => {
    const action = { type: 'wallet/setBalance', payload: { steem: '1.000 STEEM' } };
    expect(devActionSanitizer(action)).toBe(action);
  });

  it('skips null key fields without throwing', () => {
    const action = {
      type: 'auth/setCredentials',
      payload: { username: 'alice', activeKey: null },
    };
    const result = devActionSanitizer(action) as typeof action;
    expect(result.payload.activeKey).toBeNull();
  });
});
