import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * How the current session identity was established (vault R3).
 * - 'privateKey': the challenge-signed login flow (LoginForm) — the session
 *   carries key material in memory.
 * - 'vault': identity selected from the vault's public directory
 *   (VaultLoginForm) — NO key material, NO server challenge/login; the session
 *   only asserts "this tab acts as this account in Vault Mode". Signing later
 *   resolves one encrypted key per operation (A6 wiring).
 *
 * Backwards compatibility: the field is OPTIONAL on `AuthState` and an absent
 * value means 'privateKey' — every pre-R3 `AuthState` value (preloaded test
 * stores, any older state shape) stays valid and keeps its meaning. The
 * reducers always write it explicitly; read it through `sessionKindOf`.
 */
export type SessionKind = 'privateKey' | 'vault';

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
  /** Absent = 'privateKey' (see SessionKind). */
  sessionKind?: SessionKind;
}

/** The effective session kind of an auth state (absent = 'privateKey'). */
export function sessionKindOf(state: Pick<AuthState, 'sessionKind'>): SessionKind {
  return state.sessionKind ?? 'privateKey';
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
  sessionKind: 'privateKey',
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
      state.sessionKind = 'privateKey';
    },
    /**
     * Establish a Vault Mode session identity (R3). The payload carries NO
     * key material by contract: selecting an identity from the vault's
     * LOCKED-READABLE public directory neither unlocks nor decrypts anything,
     * and never calls the server challenge/login endpoints. Every private/
     * public key field is forced to null so stale key material from a
     * previous privateKey session can never leak into a vault session.
     */
    setVaultIdentity: (state, action: PayloadAction<{ username: string }>) => {
      state.username = action.payload.username;
      state.ownerKey = null;
      state.activeKey = null;
      state.postingKey = null;
      state.memoKey = null;
      state.privateKey = null;
      state.publicKey = null;
      state.isAuthenticated = true;
      state.sessionKind = 'vault';
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
      state.sessionKind = 'privateKey';
    },
  },
});

export const { setCredentials, setVaultIdentity, logout } = authSlice.actions;
export default authSlice.reducer;
