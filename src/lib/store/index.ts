import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/auth';
import walletReducer from './slices/wallet';
import uiReducer from './slices/ui';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    wallet: walletReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore non-serializable values (like private keys)
        ignoredActions: ['auth/setPrivateKey'],
        ignoredPaths: ['auth.privateKey'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
