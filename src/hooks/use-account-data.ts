'use client';

import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import { useAccount } from '@/hooks/use-account';
import type { SteemAccount } from '@/lib/steem/types';

export type AccountInfo = SteemAccount;

/**
 * Session-user account lookup. Thin wrapper over the shared useAccount hook
 * (one fetch path / cache policy — see lib/steem/accounts-client). `fresh`
 * keeps the previous no-store semantics: the consumers (power up/down,
 * witness vote forms) act on balances that may have just changed via a
 * broadcast, so they must not read a cached pre-broadcast account.
 */
export function useAccountData() {
  const username = useSelector((state: RootState) => state.auth.username);
  return useAccount(username ?? '', {
    fresh: true,
    errorMessage: 'Failed to fetch account data',
  });
}
