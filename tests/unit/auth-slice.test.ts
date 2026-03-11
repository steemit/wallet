/**
 * Auth Redux slice unit tests
 */

import { describe, it, expect } from 'vitest';
import authReducer, {
  setCredentials,
  setChallenge,
  clearChallenge,
  logout,
  type AuthState,
} from '@/lib/store/slices/auth';

describe('Auth Slice', () => {
  const initialState: AuthState = {
    username: null,
    privateKey: null,
    publicKey: null,
    isAuthenticated: false,
    challenge: null,
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
        privateKey: '5JTestPrivateKey...',
        publicKey: 'STMTestPublicKey...',
      });

      const state = authReducer(initialState, action);

      expect(state.username).toBe('testuser');
      expect(state.privateKey).toBe('5JTestPrivateKey...');
      expect(state.publicKey).toBe('STMTestPublicKey...');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should overwrite existing credentials', () => {
      const existingState: AuthState = {
        username: 'olduser',
        privateKey: 'oldkey',
        publicKey: 'oldpub',
        isAuthenticated: true,
        challenge: 'oldchallenge',
      };

      const action = setCredentials({
        username: 'newuser',
        privateKey: 'newkey',
        publicKey: 'newpub',
      });

      const state = authReducer(existingState, action);

      expect(state.username).toBe('newuser');
      expect(state.privateKey).toBe('newkey');
      expect(state.publicKey).toBe('newpub');
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe('setChallenge', () => {
    it('should set the challenge string', () => {
      const challenge = 'login-testuser-12345-abcde';
      const action = setChallenge(challenge);

      const state = authReducer(initialState, action);

      expect(state.challenge).toBe(challenge);
    });

    it('should overwrite existing challenge', () => {
      const stateWithChallenge: AuthState = {
        ...initialState,
        challenge: 'old-challenge',
      };

      const newChallenge = 'new-challenge';
      const action = setChallenge(newChallenge);

      const state = authReducer(stateWithChallenge, action);

      expect(state.challenge).toBe(newChallenge);
    });
  });

  describe('clearChallenge', () => {
    it('should clear the challenge string', () => {
      const stateWithChallenge: AuthState = {
        ...initialState,
        challenge: 'some-challenge',
      };

      const action = clearChallenge();
      const state = authReducer(stateWithChallenge, action);

      expect(state.challenge).toBeNull();
    });

    it('should not affect other state properties', () => {
      const stateWithChallenge: AuthState = {
        username: 'testuser',
        privateKey: 'testkey',
        publicKey: 'testpub',
        isAuthenticated: true,
        challenge: 'some-challenge',
      };

      const action = clearChallenge();
      const state = authReducer(stateWithChallenge, action);

      expect(state.challenge).toBeNull();
      expect(state.username).toBe('testuser');
      expect(state.isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('should clear all auth state', () => {
      const loggedInState: AuthState = {
        username: 'testuser',
        privateKey: 'testkey',
        publicKey: 'testpub',
        isAuthenticated: true,
        challenge: 'some-challenge',
      };

      const action = logout();
      const state = authReducer(loggedInState, action);

      expect(state.username).toBeNull();
      expect(state.privateKey).toBeNull();
      expect(state.publicKey).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.challenge).toBeNull();
    });

    it('should handle logout when already logged out', () => {
      const action = logout();
      const state = authReducer(initialState, action);

      expect(state).toEqual(initialState);
    });
  });

  describe('State Transitions', () => {
    it('should handle login flow', () => {
      // Set challenge first
      let state = authReducer(initialState, setChallenge('challenge-123'));

      expect(state.challenge).toBe('challenge-123');
      expect(state.isAuthenticated).toBe(false);

      // Then set credentials
      state = authReducer(state, setCredentials({
        username: 'testuser',
        privateKey: 'privatekey',
        publicKey: 'publickey',
      }));

      expect(state.username).toBe('testuser');
      expect(state.isAuthenticated).toBe(true);

      // Clear challenge after use
      state = authReducer(state, clearChallenge());

      expect(state.challenge).toBeNull();
      expect(state.isAuthenticated).toBe(true);
    });

    it('should handle logout flow', () => {
      // Start with logged in state
      const loggedInState: AuthState = {
        username: 'testuser',
        privateKey: 'privatekey',
        publicKey: 'publickey',
        isAuthenticated: true,
        challenge: 'challenge-123',
      };

      // Logout
      const state = authReducer(loggedInState, logout());

      expect(state).toEqual(initialState);
    });
  });
});
