// Session key source (A6-T1) — the login-state WIF getter injected into the
// legacy privateKey signer at the vault composition root. It reads ONLY the
// current Redux session keys of the logged-in account (the auth slice's
// per-role key fields) — never the Legacy remembered keys in localStorage
// (`browser-storage.ts` remembered-posting-key restore stays the
// claim-banner-specific affordance), never any other device storage.
//
// STORE ACCESS DECISION (verified 2026-11-21): `src/lib/store/index.ts`
// exports only the `makeStore()` factory — NO store singleton — because the
// app intentionally creates one store per SSR request in `providers.tsx`
// (`useState(() => makeStore())`) to keep server-side auth state isolated
// per request. Importing a singleton is therefore impossible, and having
// this module create its own store would fork state (the login flow
// dispatches to the Providers store). The least invasive correct approach is
// a module-level holder bound by `providers.tsx` right where the store is
// created — the established "store accessor for non-React modules" pattern:
//   - `bindSessionKeyStore(store)` is called from Providers' effect, so the
//     holder always references the live app store on the client; the effect
//     never runs during SSR, so no server request state is ever retained.
//   - The getter reads `getState()` AT SIGNING TIME (the holder is only
//     captured, never snapshotted), so later logins/logouts are seen without
//     re-composing the vault runtime.
//   - When nothing is bound the getter fails CLOSED (`undefined`), which the
//     legacy signer maps to `VAULT_KEY_INVALID` — never a crash, never a
//     fallback to another key source.
//
// ROLE MAPPING: `SigningRole` maps 1:1 onto the auth slice's per-role key
// fields (owner/active/posting). A role whose session field is null returns
// `undefined` — there is deliberately NO fallback to the slice's legacy
// `privateKey` compat field (it is "typically active", not role-accurate;
// silently signing a posting-class request with the active key would change
// which authority the session proves). A vault session holds no key material
// by construction (`setVaultIdentity` wipes all key fields), so vault
// sessions fail closed to `VAULT_KEY_INVALID` with no explicit sessionKind
// branch needed here.
//
// Account matching goes through `sameSteemAccount` (the shared
// normalizeSteemUsername-based helper) — never a raw comparison. This module
// must not import `@/lib/steem/client` (cycle risk:
// legacy-private-key-signer.ts already imports `apiClient` from it).
//
// SENSITIVE-DATA RULES: the WIF exists only as a getter result inside the
// signing call; it is never logged, never embedded in errors, and the Redux
// DevTools sanitizers already redact the source fields.
import type { LegacyPrivateKeyGetter } from '@/lib/auth/legacy-private-key-signer';
import type { AuthState } from '@/lib/store/slices/auth';
import type { SigningRole } from '@/lib/vault/types';
import { sameSteemAccount } from '@/lib/steem/username';

/**
 * Structural view of the Redux store this module needs. The real `AppStore`
 * (and test doubles) satisfy it without importing the store module at
 * runtime.
 */
export interface SessionKeyStoreLike {
  getState(): { auth: AuthState };
}

/** AuthState role-key fields indexed by the facade's SigningRole. */
const ROLE_KEY_FIELD: Record<SigningRole, 'ownerKey' | 'activeKey' | 'postingKey'> = {
  owner: 'ownerKey',
  active: 'activeKey',
  posting: 'postingKey',
};

let sessionStore: SessionKeyStoreLike | null = null;

/**
 * Bind the app's Redux store (called once from `providers.tsx`). Structural
 * on purpose so tests can substitute a plain `{ getState }` object.
 */
export function bindSessionKeyStore(store: SessionKeyStoreLike): void {
  sessionStore = store;
}

/** Drop the bound store (test isolation helper; mirrors resetVaultRuntime). */
export function resetSessionKeyStore(): void {
  sessionStore = null;
}

/**
 * Build the login-state WIF getter for `createLegacyPrivateKeySigner`. The
 * returned getter resolves per signing request and returns `undefined`
 * whenever the current session cannot sign for that (account, role) pair.
 */
export function createSessionKeyGetter(): LegacyPrivateKeyGetter {
  return (accountName: string, role: SigningRole): string | undefined => {
    // Fail closed when no store was bound (pre-effect window / tests).
    const auth = sessionStore?.getState().auth;
    if (auth === undefined) return undefined;
    // Only the logged-in account's own session keys are ever handed out.
    if (!sameSteemAccount(auth.username, accountName)) return undefined;
    return auth[ROLE_KEY_FIELD[role]] ?? undefined;
  };
}
