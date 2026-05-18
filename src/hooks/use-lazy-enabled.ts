'use client';

import { useSyncExternalStore } from 'react';

function noopSubscribe(): () => void {
  return () => {};
}

/**
 * Returns false during SSR (getServerSnapshot) and true in the browser.
 * Use to defer client-only data fetching; pair with dynamic ssr:false if output differs.
 */
export function useLazyEnabled(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
