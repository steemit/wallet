import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/auth';
import walletReducer from './slices/wallet';
import uiReducer from './slices/ui';

export const makeStore = () =>
  configureStore({
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

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
