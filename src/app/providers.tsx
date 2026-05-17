'use client';

import { useState } from 'react';
import { Provider } from 'react-redux';
import { makeStore, AppStore } from '@/lib/store';

export function Providers({ children }: { children: React.ReactNode }) {
  // Lazy initializer runs once per component mount.
  // On the server each request renders a fresh tree, so makeStore() produces
  // an isolated store per request — preventing auth state from leaking between users.
  // On the client the state persists across re-renders, keeping a single instance.
  const [store] = useState<AppStore>(() => makeStore());

  return <Provider store={store}>{children}</Provider>;
}
