import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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
  challenge: string | null;
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
  challenge: null,
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
    },
    setChallenge: (state, action: PayloadAction<string>) => {
      state.challenge = action.payload;
    },
    clearChallenge: (state) => {
      state.challenge = null;
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
      state.challenge = null;
    },
  },
});

export const { setCredentials, setChallenge, clearChallenge, logout } =
  authSlice.actions;
export default authSlice.reducer;
