'use client';

import { createSelector } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';
import type { RootState } from '@/lib/store';
import type { AuthRoleKeys } from '@/lib/wallet/account-keys';

const selectAuthRoleKeys = createSelector(
  [
    (state: RootState) => state.auth.username,
    (state: RootState) => state.auth.ownerKey,
    (state: RootState) => state.auth.activeKey,
    (state: RootState) => state.auth.postingKey,
    (state: RootState) => state.auth.memoKey,
  ],
  (username, ownerKey, activeKey, postingKey, memoKey): AuthRoleKeys & { username: string | null } => ({
    username,
    ownerKey,
    activeKey,
    postingKey,
    memoKey,
  })
);

export function useAuthRoleKeys(): AuthRoleKeys & { username: string | null } {
  return useSelector(selectAuthRoleKeys);
}
