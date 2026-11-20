'use client';

import { useEffect, useState } from 'react';
import { Provider } from 'react-redux';
import { makeStore, AppStore } from '@/lib/store';
import { bindSessionKeyStore } from '@/lib/auth/session-key-source';

export function Providers({ children }: { children: React.ReactNode }) {
  // Lazy initializer runs once per component mount.
  // On the server each request renders a fresh tree, so makeStore() produces
  // an isolated store per request — preventing auth state from leaking between users.
  // On the client the state persists across re-renders, keeping a single instance.
  const [store] = useState<AppStore>(() => makeStore());

  // Expose the live store to non-React modules (the vault runtime's legacy
  // privateKey signer reads session keys at signing time through it — see
  // src/lib/auth/session-key-source.ts). An effect, not the state
  // initializer, so StrictMode's double-invoked initializer can never leave a
  // discarded store bound; the effect never runs during SSR, so no
  // server-side request state is retained. The effect deliberately has NO
  // cleanup (nothing unbinds on unmount): Providers never unmounts in
  // practice, and a StrictMode cleanup pass would open an unbound window
  // between the simulated unmount and remount.
  useEffect(() => {
    bindSessionKeyStore(store);
  }, [store]);

  return <Provider store={store}>{children}</Provider>;
}
