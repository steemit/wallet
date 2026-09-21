/**
 * Auth Redux slice unit tests
 */

import { describe, it, expect } from 'vitest';
import authReducer, {
  setCredentials,
  logout,
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
});
