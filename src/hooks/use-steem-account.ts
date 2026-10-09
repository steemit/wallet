'use client';

import { useAccount } from '@/hooks/use-account';

/**
 * Page-account lookup (settings, market). Thin wrapper over the shared
 * useAccount hook (one fetch path / cache policy — see
 * lib/steem/accounts-client). `fresh` keeps the previous no-store semantics:
 * these surfaces read key/balance state the user may have just changed.
 */
export function useSteemAccount(username: string) {
  return useAccount(username, { fresh: true });
}
