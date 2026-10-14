import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type AuthMethod = 'key' | 'keychain';

export interface AuthState {
  username: string | null;
  // Individual role keys, only kept in memory and never persisted
  ownerKey: string | null;
  activeKey: string | null;
  postingKey: string | null;
  memoKey: string | null;
  // Backwards-compatible fields for existing hooks/components
  privateKey: string | null; // Primary key used for signing (typically active)
  publicKey: string | null;
  isAuthenticated: boolean;
  // How this session signs: 'key' holds real WIFs above; 'keychain' never
  // does (the extension never exposes a key to the page) — every role-key
  // field above stays null for a keychain session. See
  // src/hooks/use-auth.ts (useActiveSigningKey / usePostingSigningKey) for
  // where signing actually dispatches to the extension.
  authMethod: AuthMethod;
}

const initialState: AuthState = {
  username: null,
  ownerKey: null,
  activeKey: null,
  postingKey: null,
  memoKey: null,
  privateKey: null,
  publicKey: null,
  isAuthenticated: false,
  authMethod: 'key',
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (
      state,
      action: PayloadAction<{
        username: string;
        // At least one of these should be provided; others are optional
        ownerKey?: string | null;
        activeKey?: string | null;
        postingKey?: string | null;
        memoKey?: string | null;
        // Optional for compatibility with older code
        privateKey?: string | null;
        publicKey?: string | null;
      }>
    ) => {
      const {
        username,
        ownerKey = null,
        activeKey = null,
        postingKey = null,
        memoKey = null,
        privateKey,
        publicKey = null,
      } = action.payload;

      state.username = username;
      state.ownerKey = ownerKey;
      state.activeKey = activeKey;
      state.postingKey = postingKey;
      state.memoKey = memoKey;

      // For backwards compatibility, keep a primary privateKey field.
      // Prefer explicit activeKey, otherwise fall back to any provided key.
      state.privateKey =
        privateKey ??
        activeKey ??
        ownerKey ??
        postingKey ??
        memoKey ??
        null;

      state.publicKey = publicKey;
      state.isAuthenticated = true;
      state.authMethod = 'key';
    },
    /**
     * Keychain login: the extension verified the challenge signature itself
     * and the server confirmed the public key belongs to the account (same
     * `/api/auth/login` check as a raw-key login — it is signature/pubkey
     * agnostic). There is no private key to store: every role-key field is
     * explicitly nulled so existing raw-key consumers (permissions/reveal
     * page, the change-recovery-account dialog) see the same "no key
     * available" state they already handle for a partial-key login.
     */
    setKeychainCredentials: (
      state,
      action: PayloadAction<{ username: string; publicKey: string }>
    ) => {
      const { username, publicKey } = action.payload;
      state.username = username;
      state.ownerKey = null;
      state.activeKey = null;
      state.postingKey = null;
      state.memoKey = null;
      state.privateKey = null;
      state.publicKey = publicKey;
      state.isAuthenticated = true;
      state.authMethod = 'keychain';
    },
    logout: (state) => {
      state.username = null;
      state.ownerKey = null;
      state.activeKey = null;
      state.postingKey = null;
      state.memoKey = null;
      state.privateKey = null;
      state.publicKey = null;
      state.isAuthenticated = false;
      state.authMethod = 'key';
    },
  },
});

export const { setCredentials, setKeychainCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
