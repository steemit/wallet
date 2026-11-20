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
//   - sessionKind 'privateKey' → the STATIC legacy signer below. NO dialog,
//     no authority pre-check, no extra network calls — today's behavior.
//     The effective role is the LOWEST session key at-or-above the caller's
//     floor (active → owner), mirroring `useActiveSigningKey` and the
//     key-selection rule in docs/AI-driver/06-frontend.md. When the session
//     holds no such key the legacy signer fails closed with
//     VAULT_KEY_INVALID, mapped to the `needsClassicReauth` signal so the
//     caller opens the EXISTING classic re-auth dialog.
//   - sessionKind 'vault' → the vault signer (the facade's vault backend,
//     consumed through the runtime inside VaultSigningDialog): candidates
//     come from the locked-readable public directory, the user picks one
//     (auto-selected when exactly one) and types the vault password for that
//     single operation. Errors are surfaced INSIDE the dialog (mapped
//     `vault.errors.<CODE>` i18n keys); the promise only settles with
//     `signed` or `cancelled` — cancel means "user aborted", never an error
//     banner at the caller.
//
// The two divergent mode/session combinations (a mode switch without
// re-login) are exactly why the hook routes on the session kind with the
// backend signers directly: the vault signer cannot serve a privateKey
// session (no password) and the legacy signer cannot serve a vault session
// (no Redux keys — fails closed to VAULT_KEY_INVALID by construction).
// Never build another signer at a component; never query
// /api/query/accounts outside the vault signer.
//
// RUNTIME INDEPENDENCE OF THE privateKey PATH (round-1 review, P2): the
// legacy signer is STATELESS — an injected WIF getter plus steem-js — with
// ZERO registry/IndexedDB dependency, so consumer privateKey signing uses
// the module-level instance below REGARDLESS of the vault runtime's
// lifecycle: a still-loading runtime or storage-blocked environments
// (cross-origin iframes under storage partitioning, IDB-disabled browsers)
// keep signing exactly like the pre-T2 `SteemSigner` path, which also never
// needed storage. Do NOT "fix" this back into a runtime dependency (the
// runtime's exposed `legacySigner` is an equally stateless twin serving the
// facade's mode dispatch) and do NOT add a silent SteemSigner fallback. The
// VAULT path does need the runtime (IndexedDB) by design — its errors
// surface inside the dialog.
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
import { sameSteemAccount } from '@/lib/steem/username';
import { createLegacyPrivateKeySigner } from '@/lib/auth/legacy-private-key-signer';
import { createSessionKeyGetter } from '@/lib/auth/session-key-source';
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

/**
 * The privateKey backend, built once at module load (see RUNTIME
 * INDEPENDENCE above). Safe as a module singleton: it holds nothing but the
 * store-bound getter and reads the live session at signing time.
 */
const staticLegacySigner = createLegacyPrivateKeySigner(createSessionKeyGetter());

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
 * Session-kind signing entry. One in-flight request per surface — BOTH
 * paths: a second `sign()` call while one is pending (dialog open or
 * privateKey signing in flight) resolves as `cancelled` immediately (real
 * callers never overlap — confirm buttons disable themselves), and a host
 * that unmounts mid-dialog resolves the abandoned promise as `cancelled`
 * too.
 */
export function useSessionSigning(): {
  sign: (request: SessionSignRequest) => Promise<SessionSignOutcome>;
  /** Mount once per surface; non-null only while a vault request is pending. */
  dialog: React.ReactNode;
} {
  const auth = useSelector((state: RootState) => state.auth);
  const [pending, setPending] = useState<SessionSignRequest | null>(null);
  // The pending vault request's resolver. Written only inside handlers /
  // effects — never during render (the state above drives rendering, this
  // ref drives the one-shot promise handshake).
  const resolveRef = useRef<((outcome: SessionSignOutcome) => void) | null>(null);
  // The single in-flight guard covering both paths (see the hook doc).
  const inFlightRef = useRef(false);

  const finishVaultRequest = useCallback((outcome: VaultSigningDialogOutcome) => {
    const resolve = resolveRef.current;
    if (resolve === null) return;
    resolveRef.current = null;
    inFlightRef.current = false;
    setPending(null);
    resolve(outcome);
  }, []);

  // A host that unmounts while the dialog is open abandons the flow: resolve
  // the still-pending promise (no setState after unmount — resolve only).
  useEffect(() => {
    return () => {
      const resolve = resolveRef.current;
      if (resolve !== null) {
        resolveRef.current = null;
        inFlightRef.current = false;
        resolve({ status: 'cancelled' });
      }
    };
  }, []);

  const sign = useCallback(
    async (request: SessionSignRequest): Promise<SessionSignOutcome> => {
      // One in-flight signing per surface, BOTH paths (see the hook doc).
      if (inFlightRef.current) {
        return { status: 'cancelled' };
      }
      inFlightRef.current = true;

      if (sessionKindOf(auth) === 'vault') {
        // Defense-in-depth (round-1 review): a vault identity signs ONLY as
        // itself. Callers gate page-vs-session matching themselves; if a
        // mismatched accountName still reaches here (a future caller bug),
        // fail closed — no dialog, no key offered, no signing — rather than
        // let the dialog list another account's keys for this session.
        if (!auth.username || !sameSteemAccount(auth.username, request.accountName)) {
          console.error(
            'Vault signing request account does not match the session identity',
            request.accountName,
          );
          inFlightRef.current = false;
          return { status: 'error', code: 'VAULT_KEY_INVALID' };
        }
        // The vault path resolves through the dialog; the promise settles
        // when the user completes or cancels it. Every error the signer can
        // raise is surfaced inside the dialog, never here.
        return new Promise<SessionSignOutcome>((resolve) => {
          resolveRef.current = resolve;
          setPending(request);
        });
      }

      // privateKey path — dialogless, exactly today's signing behavior, and
      // independent of the vault runtime (see the module header).
      try {
        const role = resolveSessionSigningRole(auth, request.role);
        if (role === null) {
          // The session holds no key at-or-above the floor — classic re-auth
          // territory (the same outcome the legacy signer's VAULT_KEY_INVALID
          // maps to, resolved without a signing round-trip).
          return { status: 'needsClassicReauth' };
        }
        try {
          const result = await staticLegacySigner.signOperations({
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
      } finally {
        inFlightRef.current = false;
      }
    },
    [auth],
  );

  const dialog = pending !== null && (
    <VaultSigningDialog request={pending} onOutcome={finishVaultRequest} />
  );

  return { sign, dialog };
}
