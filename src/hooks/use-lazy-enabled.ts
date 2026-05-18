'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true only after the component has mounted in the browser.
 * Use to defer client-only data fetching (never runs during SSR).
 */
export function useLazyEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(true);
  }, []);

  return enabled;
}
