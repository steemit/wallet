'use client';

import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import type { AuthRoleKeys } from '@/lib/wallet/account-keys';

export function useAuthRoleKeys(): AuthRoleKeys & { username: string | null } {
  return useSelector((state: RootState) => ({
    username: state.auth.username,
    ownerKey: state.auth.ownerKey,
    activeKey: state.auth.activeKey,
    postingKey: state.auth.postingKey,
    memoKey: state.auth.memoKey,
  }));
}
