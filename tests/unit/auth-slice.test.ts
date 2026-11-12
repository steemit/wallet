/**
 * Auth Redux slice unit tests
 */

import { describe, it, expect } from 'vitest';
import authReducer, {
  setCredentials,
  setVaultIdentity,
  logout,
  sessionKindOf,
  type AuthState,
} from '@/lib/store/slices/auth';

describe('Auth Slice', () => {
  const initialState: AuthState = {
    username: null,
    ownerKey: null,
    activeKey: null,
    postingKey: null,
    memoKey: null,
    privateKey: null,
    publicKey: null,
    isAuthenticated: false,
    sessionKind: 'privateKey',
  };

  describe('Initial State', () => {
    it('should return the initial state', () => {
      expect(authReducer(undefined, { type: 'unknown' })).toEqual(initialState);
    });
  });

  describe('setCredentials', () => {
    it('should set user credentials and mark as authenticated', () => {
      const action = setCredentials({
        username: 'testuser',
        activeKey: '5JTestPrivateKey...',
        publicKey: 'STMTestPublicKey...',
      });

      const state = authReducer(initialState, action);

      expect(state.username).toBe('testuser');
      expect(state.activeKey).toBe('5JTestPrivateKey...');
      expect(state.privateKey).toBe('5JTestPrivateKey...');
      expect(state.publicKey).toBe('STMTestPublicKey...');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should overwrite existing credentials', () => {
      const existingState: AuthState = {
        username: 'olduser',
        ownerKey: 'oldOwner',
        activeKey: 'oldActive',
        postingKey: 'oldPosting',
        memoKey: 'oldMemo',
        privateKey: 'oldkey',
        publicKey: 'oldpub',
        isAuthenticated: true,
      };

      const action = setCredentials({
        username: 'newuser',
        activeKey: 'newActive',
        publicKey: 'newpub',
      });

      const state = authReducer(existingState, action);

      expect(state.username).toBe('newuser');
      expect(state.activeKey).toBe('newActive');
      expect(state.privateKey).toBe('newActive');
      expect(state.publicKey).toBe('newpub');
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('should clear all auth state', () => {
      const loggedInState: AuthState = {
        username: 'testuser',
        ownerKey: 'owner',
        activeKey: 'active',
        postingKey: 'posting',
        memoKey: 'memo',
        privateKey: 'testkey',
        publicKey: 'testpub',
        isAuthenticated: true,
      };

      const action = logout();
      const state = authReducer(loggedInState, action);

      expect(state.username).toBeNull();
      expect(state.privateKey).toBeNull();
      expect(state.publicKey).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it('should handle logout when already logged out', () => {
      const action = logout();
      const state = authReducer(initialState, action);

      expect(state).toEqual(initialState);
    });
  });

  describe('State Transitions', () => {
    it('should handle login flow', () => {
      // Set credentials
      const state = authReducer(
        initialState,
        setCredentials({
          username: 'testuser',
          privateKey: 'privatekey',
          publicKey: 'publickey',
        })
      );

      expect(state.username).toBe('testuser');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should handle logout flow', () => {
      // Start with logged in state
      const loggedInState: AuthState = {
        username: 'testuser',
        ownerKey: null,
        activeKey: 'privatekey',
        postingKey: null,
        memoKey: null,
        privateKey: 'privatekey',
        publicKey: 'publickey',
        isAuthenticated: true,
      };

      // Logout
      const state = authReducer(loggedInState, logout());

      expect(state).toEqual(initialState);
    });
  });

  describe('sessionKind + setVaultIdentity (vault R3)', () => {
    const KEY_FIELDS = [
      'ownerKey',
      'activeKey',
      'postingKey',
      'memoKey',
      'privateKey',
      'publicKey',
    ] as const;

    it('setCredentials marks the session as privateKey', () => {
      const state = authReducer(
        initialState,
        setCredentials({ username: 'alice', activeKey: 'active-key-value' })
      );
      expect(state.sessionKind).toBe('privateKey');
    });

    it('setVaultIdentity records the username with sessionKind vault and NO key material', () => {
      const state = authReducer(initialState, setVaultIdentity({ username: 'alice' }));

      expect(state.username).toBe('alice');
      expect(state.isAuthenticated).toBe(true);
      expect(state.sessionKind).toBe('vault');
      for (const field of KEY_FIELDS) {
        expect(state[field], `${field} must be null in a vault session`).toBeNull();
      }
    });

    it('setVaultIdentity wipes key material left by a previous privateKey session', () => {
      const privateKeySession = authReducer(
        initialState,
        setCredentials({
          username: 'bob',
          ownerKey: 'owner-key-value',
          activeKey: 'active-key-value',
          postingKey: 'posting-key-value',
          memoKey: 'memo-key-value',
          publicKey: 'public-key-value',
        })
      );

      const state = authReducer(privateKeySession, setVaultIdentity({ username: 'alice' }));

      expect(state.username).toBe('alice');
      expect(state.sessionKind).toBe('vault');
      for (const field of KEY_FIELDS) {
        expect(state[field], `${field} must be wiped by setVaultIdentity`).toBeNull();
      }
    });

    it('logout from a vault session returns to the initial privateKey state', () => {
      const vaultSession = authReducer(initialState, setVaultIdentity({ username: 'alice' }));
      expect(authReducer(vaultSession, logout())).toEqual(initialState);
    });

    it('sessionKindOf treats an absent field as privateKey (pre-R3 state shape)', () => {
      const legacyShape: AuthState = {
        username: 'carol',
        ownerKey: null,
        activeKey: 'active-key-value',
        postingKey: null,
        memoKey: null,
        privateKey: 'active-key-value',
        publicKey: null,
        isAuthenticated: true,
      };
      expect(sessionKindOf(legacyShape)).toBe('privateKey');
      expect(sessionKindOf({ sessionKind: 'vault' })).toBe('vault');
    });
  });
});
