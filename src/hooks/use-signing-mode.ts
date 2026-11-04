// Signing-mode state hook (A5) — the UI wrapper around the SigningFacade's
// mode persistence (registry settings row, default `'privateKey'`).
//
// CONTRACTS (kickoff A5 + A4 review notes):
//   - A successful switch updates LOCAL state only — never reloads or
//     navigates. `facade.setSigningMode` persists before it resolves, so once
//     the awaited call returns the stored mode already matches the UI.
//   - A FAILED switch rethrows after keeping local state untouched: the
//     component keeps displaying the original mode ("failure preserves the
//     previous mode" is exactly the facade's persist-only-on-success
//     semantics — see signing-facade.ts — plus this hook not updating on
//     rejection).
//   - The mode is a device preference: it does NOT depend on the login
//     state and is available signed-out.
//
// This hook never touches key material — mode strings only.
import { useCallback, useEffect, useState } from 'react';

import { VaultError } from '@/lib/vault/errors';
import type { SigningFacade, SigningMode } from '@/lib/vault/types';

export interface UseSigningModeResult {
  /** The persisted mode, or null while it is loading / unavailable. */
  mode: SigningMode | null;
  /** True while the initial `getSigningMode` read is in flight. */
  loading: boolean;
  /** True while a `setMode` call is in flight. */
  switching: boolean;
  /** True when the initial read failed (facade null or storage error). */
  loadFailed: boolean;
  /** Re-run the initial mode read. */
  retryLoad: () => void;
  /**
   * Persist `next` as the signing mode. Resolves after the mode is stored
   * and updates local state (no refresh). REJECTS with the facade's error on
   * failure — callers catch it to surface the mapped message while this hook
   * keeps showing the previous mode.
   */
  setMode: (next: SigningMode) => Promise<void>;
}

/**
 * Track and switch the persisted signing mode through the facade. Pass the
 * facade from the app's vault runtime (composition root) or `null` when the
 * runtime is unavailable — then `loadFailed` is true and `setMode` rejects
 * with `VAULT_STORAGE_UNAVAILABLE`.
 */
export function useSigningMode(facade: SigningFacade | null): UseSigningModeResult {
  const [mode, setModeState] = useState<SigningMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!facade) {
      // A null facade is DERIVED unavailability (see the return value below);
      // no state to write here.
      return;
    }
    let cancelled = false;
    facade
      .getSigningMode()
      .then((stored) => {
        if (!cancelled) {
          setModeState(stored);
          setLoading(false);
          setLoadFailed(false);
        }
      })
      .catch((error) => {
        console.error('Failed to read the signing mode', error);
        if (!cancelled) {
          setLoadFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [facade, reloadNonce]);

  const setMode = useCallback(
    async (next: SigningMode) => {
      if (!facade) {
        throw new VaultError('VAULT_STORAGE_UNAVAILABLE', 'vault runtime is not available');
      }
      setSwitching(true);
      try {
        // Persists only on success; a rejection leaves both the stored row
        // and this hook's state on the previous mode.
        await facade.setSigningMode(next);
        setModeState(next);
      } finally {
        setSwitching(false);
      }
    },
    [facade],
  );

  const retryLoad = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  const facadeUnavailable = facade === null;
  return {
    mode: facadeUnavailable ? null : mode,
    loading: !facadeUnavailable && loading,
    switching,
    loadFailed: facadeUnavailable || loadFailed,
    retryLoad,
    setMode,
  };
}
