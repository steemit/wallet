import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Balance {
  steem: string;
  sbd: string;
  vests: string;
}

interface WalletState {
  balance: Balance | null;
  loading: boolean;
  error: string | null;
}

const initialState: WalletState = {
  balance: null,
  loading: false,
  error: null,
};

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setBalance: (state, action: PayloadAction<Balance>) => {
      state.balance = action.payload;
      state.loading = false;
      state.error = null;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    clearWallet: (state) => {
      state.balance = null;
      state.loading = false;
      state.error = null;
    },
  },
});

export const { setBalance, setLoading, setError, clearWallet } =
  walletSlice.actions;
export default walletSlice.reducer;
