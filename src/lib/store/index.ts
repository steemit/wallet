import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/auth';
import walletReducer from './slices/wallet';
import uiReducer from './slices/ui';
import type { AuthState } from './slices/auth';

// All private-key fields stored in the auth slice.
const AUTH_KEY_FIELDS = ['ownerKey', 'activeKey', 'postingKey', 'memoKey', 'privateKey'] as const;
type AuthKeyField = (typeof AUTH_KEY_FIELDS)[number];

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
          // auth/setCredentials carries private key strings; list all key paths
          // so the middleware never logs or warns about them.
          ignoredActions: ['auth/setCredentials'],
          ignoredPaths: AUTH_KEY_FIELDS.map((k) => `auth.${k}`),
        },
      }),
    devTools:
      process.env.NODE_ENV === 'production'
        ? // Completely disabled in production — no DevTools extension should
          // ever be able to inspect the store on a real user's session.
          false
        : {
            // In development DevTools remain fully functional for every slice
            // except that live key values are replaced before they reach the
            // extension, so a developer's own keys are never shown in plain text.
            stateSanitizer: (state) => {
              const s = state as unknown as { auth: AuthState; [k: string]: unknown };
              const sanitizedAuth: AuthState = { ...s.auth };
              for (const field of AUTH_KEY_FIELDS) {
                if (sanitizedAuth[field] != null)
                  (sanitizedAuth as Record<AuthKeyField, string | null>)[field] = '[REDACTED]';
              }
              return { ...s, auth: sanitizedAuth } as typeof state;
            },
            actionSanitizer: (action) => {
              if (action.type !== 'auth/setCredentials') return action;
              const a = action as unknown as { type: string; payload: Partial<Record<AuthKeyField, string | null>> };
              const payload = { ...a.payload };
              for (const field of AUTH_KEY_FIELDS) {
                if (payload[field] != null) payload[field] = '[REDACTED]';
              }
              return { ...action, payload } as typeof action;
            },
          },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
