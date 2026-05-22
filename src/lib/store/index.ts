import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/auth';
import walletReducer from './slices/wallet';
import uiReducer from './slices/ui';
import type { AuthState } from './slices/auth';

const AUTH_KEY_FIELDS = ['ownerKey', 'activeKey', 'postingKey', 'memoKey', 'privateKey'] as const;
type AuthKeyField = (typeof AUTH_KEY_FIELDS)[number];

export function devStateSanitizer<S>(state: S): S {
  const s = state as unknown as { auth: AuthState; [k: string]: unknown };
  const sanitizedAuth: AuthState = { ...s.auth };
  for (const field of AUTH_KEY_FIELDS) {
    if (sanitizedAuth[field] != null)
      (sanitizedAuth as Record<AuthKeyField, string | null>)[field] = '[REDACTED]';
  }
  return { ...s, auth: sanitizedAuth } as unknown as S;
}

export function devActionSanitizer<A>(action: A): A {
  const a = action as unknown as { type: string; payload: Partial<Record<AuthKeyField, string | null>> };
  if (a.type !== 'auth/setCredentials') return action;
  const payload = { ...a.payload };
  for (const field of AUTH_KEY_FIELDS) {
    if (payload[field] != null) payload[field] = '[REDACTED]';
  }
  return { ...(action as object), payload } as unknown as A;
}

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
          ignoredActions: ['auth/setCredentials'],
          ignoredPaths: AUTH_KEY_FIELDS.map((k) => `auth.${k}`),
        },
      }),
    devTools:
      process.env.NODE_ENV === 'production'
        ? false
        : {
            stateSanitizer: devStateSanitizer,
            actionSanitizer: devActionSanitizer,
          },
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
