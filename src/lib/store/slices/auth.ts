import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface AuthState {
  username: string | null;
  privateKey: string | null; // Only in memory, never persisted
  publicKey: string | null;
  isAuthenticated: boolean;
  challenge: string | null;
}

const initialState: AuthState = {
  username: null,
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
        privateKey: string;
        publicKey: string;
      }>
    ) => {
      state.username = action.payload.username;
      state.privateKey = action.payload.privateKey;
      state.publicKey = action.payload.publicKey;
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
