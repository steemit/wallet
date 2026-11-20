'use client';

// Unified consumer signing entry (A6-T2) — the ONE pattern business callers
// use to sign operations with whatever session they have:
//
//   const signing = useSessionSigning();
//   const outcome = await signing.sign({
//     operations, accountName: username, role: 'active',
//   });
//   switch (outcome.status) { ... }
//   return <>{form}{signing.dialog}</>   // mounts the vault password dialog
//
// Routing is by SESSION KIND (docs/AI-driver/09-vault.md invariant 21), not
// the persisted device mode the facade dispatches on:
//   - sessionKind 'privateKey' → the legacy signer (the facade's privateKey
//     backend, wired at the composition root since A6-T1). NO dialog, no
//     authority pre-check, no extra network calls — today's behavior. The
//     effective role is the LOWEST session key at-or-above the caller's
//     floor (active → owner), mirroring `useActiveSigningKey` and the
//     key-selection rule in docs/AI-driver/06-frontend.md. When the session
//     holds no such key the legacy signer fails closed with
//     VAULT_KEY_INVALID, mapped to the `needsClassicReauth` signal so the
//     caller opens the EXISTING classic re-auth dialog.
//   - sessionKind 'vault' → the vault signer (the facade's vault backend)
//     through `VaultSigningDialog`: candidates come from the locked-readable
//     public directory, the user picks one (auto-selected when exactly one)
//     and types the vault password for that single operation. Errors are
//     surfaced INSIDE the dialog (mapped `vault.errors.<CODE>` i18n keys);
//     the promise only settles with `signed` or `cancelled` — cancel means
//     "user aborted", never an error banner at the caller.
//
// The two divergent mode/session combinations (a mode switch without
// re-login) are exactly why the hook talks to the backend signers directly:
// the vault signer cannot serve a privateKey session (no password) and the
// legacy signer cannot serve a vault session (no Redux keys — fails closed
// to VAULT_KEY_INVALID by construction). The instances are the ones wired
// into the facade at the composition root; nothing here builds a signer.
//
// SENSITIVE-DATA RULES: the hook itself never touches key material. The
// vault password lives only inside the dialog's transient state and the one
// signing call; the legacy signer reads session keys at signing time through
// the session key source. Nothing sensitive reaches Redux (beyond the
// pre-existing auth fields), logs or persisted state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { RootState } from '@/lib/store';
import { sessionKindOf } from '@/lib/store/slices/auth';
import { useVaultRuntime } from '@/components/vault/vault-manager';
import {
  VaultSigningDialog,
  signingRolesAtOrAbove,
  type SessionSignRequest,
  type VaultSigningDialogOutcome,
} from '@/components/vault/vault-signing-dialog';
import { VaultError } from '@/lib/vault/errors';
import type { SignResult, SigningRole, VaultErrorCode } from '@/lib/vault/types';

/** Discriminated outcome every caller switches on. */
export type SessionSignOutcome =
  | { status: 'signed'; result: SignResult }
  /** The user aborted the vault dialog — treat as a no-op, no error banner. */
  | { status: 'cancelled' }
  /**
   * A privateKey session lacks a key for the request — the caller opens the
   * EXISTING classic re-auth dialog (unchanged privateKey behavior).
   */
  | { status: 'needsClassicReauth' }
  /** Dialogless path failure the caller surfaces through its error UX. */
  | { status: 'error'; code: VaultErrorCode | 'unexpected' };

export type { SessionSignRequest };

/** Auth-slice role fields indexed by SigningRole (mirrors session-key-source). */
const ROLE_KEY_FIELD: Record<SigningRole, 'ownerKey' | 'activeKey' | 'postingKey'> = {
  owner: 'ownerKey',
  active: 'activeKey',
  posting: 'postingKey',
};

/** The lowest role at-or-above `floor` whose session key is held, else null. */
export function resolveSessionSigningRole(
  auth: Pick<RootState['auth'], 'ownerKey' | 'activeKey' | 'postingKey'>,
  floor: SigningRole,
): SigningRole | null {
  for (const role of signingRolesAtOrAbove(floor)) {
    if (auth[ROLE_KEY_FIELD[role]]) return role;
  }
  return null;
}

/**
 * Session-kind signing entry. One in-flight request per surface: a second
 * `sign()` call while one is pending resolves as `cancelled` immediately
 * (real callers never overlap — confirm buttons disable themselves), and a
 * host that unmounts mid-dialog resolves the abandoned promise as
 * `cancelled` too.
 */
export function useSessionSigning(): {
  sign: (request: SessionSignRequest) => Promise<SessionSignOutcome>;
  /** Mount once per surface; non-null only while a vault request is pending. */
  dialog: React.ReactNode;
} {
  const runtime = useVaultRuntime();
  const auth = useSelector((state: RootState) => state.auth);
  const [pending, setPending] = useState<SessionSignRequest | null>(null);
  // The pending request's resolver. Written only inside handlers/effects —
  // never during render (the state above drives rendering, this ref drives
  // the one-shot promise handshake).
  const resolveRef = useRef<((outcome: SessionSignOutcome) => void) | null>(null);

  // A host that unmounts while the dialog is open abandons the flow: resolve
  // the still-pending promise (no setState after unmount — resolve only).
  useEffect(() => {
    return () => {
      const resolve = resolveRef.current;
      if (resolve !== null) {
        resolveRef.current = null;
        resolve({ status: 'cancelled' });
      }
    };
  }, []);

  const onDialogOutcome = useCallback((outcome: VaultSigningDialogOutcome) => {
    const resolve = resolveRef.current;
    if (resolve === null) return;
    resolveRef.current = null;
    setPending(null);
    resolve(outcome);
  }, []);

  const sign = useCallback(
    async (request: SessionSignRequest): Promise<SessionSignOutcome> => {
      // One in-flight signing per surface (see the hook doc).
      if (resolveRef.current !== null) {
        return { status: 'cancelled' };
      }

      if (sessionKindOf(auth) === 'vault') {
        // The vault path resolves through the dialog; the promise settles
        // when the user completes or cancels it. Every error the signer can
        // raise is surfaced inside the dialog, never here.
        return new Promise<SessionSignOutcome>((resolve) => {
          resolveRef.current = resolve;
          setPending(request);
        });
      }

      // privateKey path — dialogless, exactly today's signing behavior.
      if (runtime.state !== 'ready') {
        // Fail closed: the legacy signer instance is composed in the runtime
        // (one tab = one wiring). Unavailable storage or a still-initializing
        // runtime cannot sign; the caller surfaces the mapped code.
        return {
          status: 'error',
          code: runtime.state === 'unavailable' ? runtime.code : 'VAULT_STORAGE_UNAVAILABLE',
        };
      }
      const role = resolveSessionSigningRole(auth, request.role);
      if (role === null) {
        // The session holds no key at-or-above the floor — classic re-auth
        // territory (the same outcome the legacy signer's VAULT_KEY_INVALID
        // maps to, resolved without a signing round-trip).
        return { status: 'needsClassicReauth' };
      }
      try {
        const result = await runtime.legacySigner.signOperations({
          accountName: request.accountName,
          role,
          // keyIv/vaultPassword are vault-path fields; the legacy signer
          // never reads them (it sources its WIF from the session store).
          keyIv: '',
          vaultPassword: '',
          operations: request.operations,
        });
        return { status: 'signed', result };
      } catch (error) {
        if (error instanceof VaultError) {
          if (error.code === 'VAULT_KEY_INVALID') {
            return { status: 'needsClassicReauth' };
          }
          return { status: 'error', code: error.code };
        }
        console.error('Unexpected privateKey signing error', error);
        return { status: 'error', code: 'unexpected' };
      }
    },
    [auth, runtime],
  );

  const dialog = pending !== null && (
    <VaultSigningDialog request={pending} onOutcome={onDialogOutcome} />
  );

  return { sign, dialog };
}
