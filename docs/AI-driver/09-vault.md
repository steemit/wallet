# 09 — Vault (encrypted multi-account wallet)

> Status date: 2026-11-05. **R1 (hierarchical per-key encryption), R2 (key
> management with on-chain verification and notes) and R3 (identity selection
> without unlocking) LANDED on this branch** —
> `feat/vault-per-key-hierarchy`, on top of `origin/next@cee626a2`
> (work-mode modal); see `git log` on this branch for the exact commits. The
> branch is NOT merged into `next` and no PR exists yet; everything below is
> branch-only until that PR lands. Tracking issue: #381.
> History: A0–A5 (PRs #382, #383, #386, #387, #389, #390, #391 and the modal
> follow-up `cee626a2`) shipped a whole-envelope implementation that was never
> released; R1 replaced it directly with the approved V1 hierarchical structure
> — **no migration layer, by decision** (the old format never survived a
> release, so there is nothing to migrate). Covers what has landed: type
> contracts, error taxonomy, V1
> hierarchical envelope validation, per-key Web Crypto, shared input validation
> with resource boundaries, the registry/service/backup layers, the manager +
> signer + unified facade, the A5 work-mode UI (mode switcher, vault manager
> panel, empty/unlock/key-confirmation dialogs) updated for the per-key contract,
> the R2 key-management layer (on-chain verification orchestration, the
> locked-state key-manager view, the add-key dialog with per-key password
> encryption), and the R3 vault identity login (mode-dispatched login form,
> two-select identity picker over the public directory, key-free
> `sessionKind: 'vault'` sessions).
> Not implemented: the B-phase dapp. The A6 caller migration is COMPLETE
> (T2 transfer pilot; T3a the eight active-class wallet ops; T3b claim /
> communities / change-password / recovery-warning; T4 market / proposals /
> witnesses) — every business signing caller now routes through
> `useSessionSigning` except the documented permanent exceptions (see the
> A6 progress note's final "who still signs directly" inventory). The A6-T5
> plaintext migration (remembered posting key -> vault, verified-readback
> deletion gate) has LANDED — invariant 22 is its contract.

## Module map

```
src/lib/vault/types.ts     Type contracts only — zero runtime code. V1 shapes:
                           VaultEnvelopeV1 = { version, vaultName, salt, accounts }
                           with per-key VaultKeyCiphertext { iv, ciphertext, note,
                           publicKey? } under four role arrays (VaultRoleKeys);
                           PUBLIC summaries (VaultSummary / VaultAccountSummary /
                           VaultKeySummary — role + iv + note + publicKey | null,
                           no key material); SENSITIVE
                           VaultSigningSession (per-operation only); signing
                           requests carry keyIv + vaultPassword; ImportVaultParams
                           merge variant carries targetPassword; the 17 error codes
src/lib/vault/errors.ts    VaultError (code + English message); codes come from types.ts
src/lib/vault/envelope.ts  base64url codec (canonical-only) + V1 HIERARCHICAL
                           validation: exact field sets at root / account, key
                           level = iv/ciphertext/note REQUIRED + optional
                           non-empty-string publicKey (unknown fields still
                           rejected), exactly four role arrays,
                           unique normalized account names, IV uniqueness across
                           the whole vault, canonical base64url, salt = 16 B,
                           key IV = 12 B, ciphertext >= 16 B GCM-tag floor;
                           parseVaultEnvelopeJson raw-JSON entry point (1 MiB gate);
                           emptyVaultRoleKeys helper; the shared resource-bound
                           constants (<= 400 keys, <= 100 accounts, 1 MiB caps)
src/lib/vault/crypto.ts    PBKDF2 KEK derivation (one password + the shared salt)
                           + SINGLE-KEY AES-GCM primitives encryptVaultKey /
                           decryptVaultKey (IV always explicit — fixed vectors)
                           + CSPRNG salt/IV generators + encryptVaultKeyRecord
                           (random fresh IV, skips excludedIvs); VAULT_AAD =
                           'steem-wallet.vault.v1'; 600k iterations / 16 B salt /
                           12 B IV / 32 B KEK as exported constants
src/lib/vault/validation.ts  Shared vault alias / password / account-name / WIF
                           validation + NFC display values + alias comparison key
                           (A1.1, unchanged by R1); validateVaultWif returns the
                           derived public key + normalized account
src/lib/vault/registry.ts  IndexedDB layer (A2): `steem-wallet-vault` v1 with
                           `vaults` (keyPath = NFC display name) + `settings`
                           stores; atomic alias uniqueness inside one readwrite
                           transaction (comparison key scanned via getAll — never
                           persisted, never in the AAD); createVault stores an
                           EMPTY accounts list with a fresh salt (zero keys, no
                           crypto beyond the duplicate-name pre-check);
                           revision/lockEpoch/createdAt CAS (swapRecord);
                           bumpLockEpoch; rename/remove keep the settings pointer
                           coherent; vaultRecordToEnvelope strips runtime fields
src/lib/vault/service.ts   Session service, per-key era: the session is a
                           NON-SENSITIVE VaultRevisionPointer only — no KEK, no
                           plaintext WIF ever lives in the closure. unlock =
                           derive KEK -> authenticate by decrypting exactly ONE
                           key (first found) + validateVaultWif -> zeroize KEK,
                           keep the pointer (locks any previous session first).
                           getAccounts / getEnvelope / getRecordSnapshot are
                           LOCKED-READABLE (resolve session vault -> active
                           vault -> VAULT_EMPTY): the public directory
                           (accountName / role / iv / note / publicKey | null)
                           needs no password.
                           commitAccounts = full-envelope-validate + CAS payload
                           write; addKey (password-authenticated insert, fresh IV,
                           persists the outer publicKey — caller-supplied or
                           WIF-derived; duplicate detection FIRST compares the
                           stored publicKey field of the role's existing keys
                           without decrypting, falling back to the transient
                           decrypt probe for legacy field-less entries — no write
                           on duplicate); removeKey
                           (located by account + role + IV); updateKeyNote (note
                           edit, ciphertext and publicKey untouched);
                           BroadcastChannel as acceleration layer only
src/lib/vault/manager.ts    VaultManager orchestration: the VaultManager surface
                           plus unlockVault / importVaultDetailed (preMergeBackup
                           handoff) / addKey / removeKey / updateKeyNote /
                           createSigner / destroy. MERGE = targetPassword
                           authentication probe (unlock only when no session on
                           the target already exists) -> mergeVaultBackup ->
                           service.lock() hard contract -> summary locked:true +
                           preMergeBackup. removeVault authenticates through a
                           throwaway probe service (the live session survives
                           untouched unless it names the removed vault).
                           exportVault locks this tab's session first.
                           changePassword: authenticate old -> capture ->
                           empty-vault rejection (VAULT_EMPTY — no key anchors
                           the old password) -> policy-check new ->
                           per-key decrypt/re-encrypt one at a time under a FRESH
                           salt with fresh IVs -> CAS -> lock
src/lib/vault/signer.ts    Per-key signer: request selects the exact encrypted
                           key by (accountName, role, keyIv) and carries
                           vaultPassword for that one operation — NO unlock, no
                           global session needed (the current record resolves via
                           the session vault or the ACTIVE vault). op->authority
                           table (19 relay ops + account_update/custom_json
                           payload-based, unknown ops rejected, recover_account
                           deliberately EXCLUDED — needs old+new owner dual
                           signatures, see client.ts signRecoverAccount); one
                           sorted batched authority fetch via accounts-client with
                           fresh:true; requested role is a FLOOR, selection scans
                           ALL key_auths at-or-above it (owner>active>posting
                           downward coverage) and requires the key alone to meet
                           weight_threshold; memo never signs. Only the selected
                           key is decrypted; KEK/WIF/password scrubbed in finally;
                           SignResult.locked is always true; the record is
                           re-asserted current around the header fetch
src/lib/vault/signing-facade.ts  Mode dispatch (A4, unchanged): settings-backed
                           signingMode (default privateKey), no silent fallback,
                           backend errors propagate verbatim
src/lib/vault/key-management.ts  R2 on-chain key verification (ADVICE, not
                           gates): verifyKeysOnChain takes WIF-FREE candidates
                           (accountName + role + publicKey — the caller derives
                           the public key locally), runs ONE sorted deduped
                           batched fetchAccounts fresh:true query and reports
                           per candidate where the key sits on-chain: full
                           key_auths scan of owner/active/posting (most
                           privileged match wins) plus memo_key comparison
                           (memo match = weight 1/threshold 1/suffices true).
                           degraded/missing/malformed/fetch failure ->
                           VAULT_AUTHORITY_UNAVAILABLE, zero side effects;
                           malformed candidates -> VAULT_KEY_INVALID. Storage
                           semantics (2026-11-05 ruling): sub-threshold keys
                           (matched, suffices:false) and not-on-chain keys
                           (matched:false) MAY be stored with UI warnings —
                           the vault is storage, not proof of authority; the
                           single-key signer keeps failing closed on both
src/hooks/use-signing-mode.ts   A5 mode-state hook wrapping the facade's
                           getSigningMode/setSigningMode: success updates local
                           state in place (never reloads), failure rethrows with
                           the previous mode still displayed. R3 fix
                           (2026-11-05, e2e-caught): every INSTANCE re-reads the
                           persisted mode on VAULT_WORK_MODE_CLOSED_EVENT and on
                           tab visibility — a switch happens inside the Work
                           Mode modal and only the switcher's own instance sees
                           it, so without the re-read other mounted consumers
                           (the LoginForm dispatcher, HomeRedirectOrLogin) kept
                           rendering the stale mode after the modal closed
src/components/vault/work-mode-switcher.tsx  A5 PrivateKey/Vault dual selector
                           (radiogroup) — device preference, works signed-out;
                           PrivateKey carries the Legacy/Deprecated badge.
                           A6-T6 keyboard behavior (ARIA authoring practices):
                           ArrowDown/Right select the next option and ArrowUp/
                           Left the previous (wrapping over the two options),
                           Home/End the first/last; the keydown is prevented
                           and selection rides the same `select` path as a
                           click, focus follows the selection, and only the
                           selected radio keeps a tab stop (roving tabindex);
                           arrows are inert while a switch is in flight
src/components/vault/vault-manager.tsx  A5+R1 composition root + panel:
                           VaultProvider/getVaultRuntime (module-singleton
                           registry + manager + facade — one tab = one session
                           service), VaultManagerPanel (vault list / create /
                           import / merge / rename / change-password / delete /
                           export). A6-T6: the panel's vault-list refresh is
                           sequence-guarded (a slow earlier listVaults response
                           is dropped when a newer refresh has landed; unmount
                           invalidates in-flight loads) and the row-action
                           info banners (e.g. exportSuccess) are cleared by a
                           successful rename/delete/merge — a directory
                           mutation invalidates the banner's referent. A6-T2:
                           the ready runtime ALSO exposes the
                           facade's two backend signer instances
                           (`vaultSigner` = manager.createSigner(),
                           `legacySigner` = createLegacyPrivateKeySigner(...))
                           for session-kind routing — useSessionSigning picks
                           the backend by who is logged in, not by the
                           persisted mode (a mid-session mode switch leaves
                           each session kind with exactly one usable backend).
                           MERGE FORM SEMANTICS (R1): the dialog asks
                           for the backup password AND the TARGET vault
                           password, is reachable and submittable on a LOCKED
                           target (no pre-unlock step; the retired
                           mergeRequiresUnlock gate is gone), and the completion
                           dialog enforces download-or-explicit-discard of the
                           preMergeBackup plus the post-merge LOCKED notice.
                           R2: the row menu's "Manage keys" opens the
                           VaultKeyManager view; merge/changePassword catch
                           handlers route VAULT_EMPTY to the scene-level
                           mergeTargetEmpty / changePasswordEmpty i18n keys
                           (sceneErrorKey) instead of the generic errors-table
                           message
src/components/vault/vault-key-manager.tsx  R2 key-manager view (locked-state
                           browsing): renders the public directory from
                           manager.getAccounts — account groups, per-role key
                           counts, outer notes, plus a SECOND indented row per
                           key entry that carries the outer publicKey (truncated
                           STM…STM monospace + copy-to-clipboard button for the
                           full key; legacy entries without the field render no
                           second row) — with NO unlock; A6-T6: the directory
                           refresh is sequence-guarded (a slow earlier
                           getAccounts response is dropped when a newer one
                           has landed; unmount invalidates in-flight loads);
                           per-key
                           operations ride manager.updateKeyNote / removeKey
                           (account + role + IV pointer, explicit confirm
                           dialog, no password — removal only deletes
                           ciphertext); "Add key" opens ImportKeyDialog;
                           A6-T5: while the device holds a VALID remembered
                           posting-key pair (readRememberedPostingKeyCandidate),
                           the header also offers "Migrate remembered key" —
                           entering that vault's key manager IS the target
                           selection; the button re-reads the device state on
                           view mount and disappears after a successful
                           migration (no remembered key left)
src/lib/vault/migration.ts  A6-T5 plaintext migration + THE DELETION GATE
                           (invariant 22): readRememberedPostingKeyCandidate
                           reads the localStorage pair and returns PUBLIC data
                           only (account + derived publicKey — never the WIF);
                           migrateRememberedPostingKey({service}, input)
                           re-reads localStorage, refuses when the pair no
                           longer matches the UI-verified account/publicKey,
                           then WRITE (service.addKey — fresh IV, password
                           authentication, dedupe no-op; an EMPTY target first
                           requires the creation-level validateVaultPassword —
                           the typed password would become the vault's
                           password) -> RE-READ (service.getRecordSnapshot — a
                           fresh registry read, never the write path's
                           in-memory record; runs for BOTH outcomes, the
                           no-op dedupe proves nothing about decryptability)
                           -> AUTHENTICATED DECRYPT of the stored posting
                           entry under the password-derived KEK +
                           derived-publicKey match -> still-current plaintext
                           check (mid-flow swap aborts) -> ONLY THEN
                           clearRememberedPostingKey + a gone post-condition
                           read (a swallowed storage error surfaces as
                           VAULT_STORAGE_UNAVAILABLE, never as success).
                           outcome 'migrated' | 'alreadyPresent' (dedupe no-op
                           detected by revision compare; verification and
                           deletion run identically). Every failure leaves the
                           plaintext untouched; the flow is re-runnable. The
                           remembered USERNAME is deliberately kept. The
                           manager exposes this as
                           VaultManagerExtended.migrateRememberedPostingKey —
                           migration UI code never re-implements the gate nor
                           deletes the plaintext itself (clearRememberedPostingKey's
                           pre-existing callers OUTSIDE the migration flow —
                           change-password rotation, logout device-auth clear —
                           are unaffected)
src/components/vault/migrate-remembered-key-dialog.tsx  A6-T5 user-initiated
                           migration dialog (opened from the key manager):
                           confirmation copy (key moves into THIS vault /
                           device plaintext removed after verified readback /
                           claim-banner auto-restore consequence / username
                           stays) + vault password -> verifyKeysOnChain on the
                           PUBLIC candidate -> shared KeyVerdictBox -> explicit
                           "Migrate now" -> manager.migrateRememberedPostingKey.
                           The component NEVER holds the WIF (stricter than the
                           add-key dialog: only the public candidate and the
                           typed password — scrubbed on success/cancel/unmount).
                           EMPTY-target anchoring (r1 P1-1): when the target's
                           public directory holds zero keys the dialog adds the
                           anchoring hint + a CONFIRM re-type and runs the
                           creation-level validateVaultPassword before any
                           chain work; the async anchoring decision is exposed
                           as the form's data-anchor-case attribute and the
                           verify button stays disabled until it lands. The
                           dialog content is capped at viewport height with
                           internal scrolling (the anchoring fields overflow
                           short viewports otherwise)
src/components/vault/key-verdict.tsx  shared on-chain verdict rendering
                           (extracted from import-key-dialog for A6-T5): pure
                           vaultKeyVerdict mapping (not-on-chain >
                           sub-threshold > authority-differs > memo > matched)
                           + the KeyVerdictBox (testId defaults to the add-key
                           dialog's marker) + the shared ROLE_LABEL_KEYS and
                           shortPublicKey helpers (moved here from
                           vault-key-manager.tsx in review r1 so leaf-ish vault
                           UI modules import them without a component cycle)
src/components/vault/vault-signing-dialog.tsx  A6-T2 per-operation password
                           dialog for vault identity sessions: candidates =
                           the locked-readable public directory entries stored
                           at roles AT-OR-ABOVE the request's floor (each
                           candidate keeps its own STORAGE role — the request
                           sends that role with the key's IV, matching
                           `selectEncryptedKey`'s `keys[role]` binding);
                           exactly one candidate auto-selects, several require
                           an explicit radio choice (no silent default);
                           A6-T6 keyboard behavior for that choice (ARIA
                           authoring practices on the native fieldset/radios):
                           the fieldset is role="radiogroup" labelled by the
                           visible heading; ArrowDown/Right select the next
                           candidate and ArrowUp/Left the previous (wrapping),
                           Home/End the first/last; with nothing selected
                           Down/Right land on the first and Up/Left on the
                           last; the keydown is prevented (the controlled
                           selection must not race the engines' differing
                           native radio behavior), focus follows the selection
                           and only the selected radio keeps a tab stop
                           (roving tabindex — the first one while nothing is
                           selected); jsdom does not implement native radio
                           arrow behavior, so the keyboard contract is unit-
                           tested against the explicit handler;
                           directory = manager.getAccounts() with NO argument
                           (the same session-vault -> active-vault resolution
                           the signer's getRecordSnapshot applies — never a
                           separate /api/query/accounts call); wrong password
                           (`VAULT_PASSWORD_INVALID`) keeps the dialog open
                           with the mapped error + retry hint and a CLEARED
                           field; every other VaultError also surfaces in-dialog
                           (`vault.errors.<CODE>`), so the host promise only
                           settles with `signed` / `cancelled`; the password
                           lives only in the form's transient state, cleared on
                           success / cancel / failed attempt / unmount (the
                           import-key-dialog discipline)
src/hooks/use-session-signing.tsx  A6-T2 unified consumer signing entry — the
                           ONE pattern business callers use (transfer-form was
                           the pilot; A6-T3a migrated the eight wallet-op
                           callers; A6-T3b migrated claim-rewards-banner,
                           communities-section, change-password-section and
                           recovery-warning-banner; A6-T4 migrated the last
                           five: market-page-client limit orders,
                           proposals-page-client votes,
                           proposal-creator-dialog, proposal-remove-dialog
                           and witness-vote-form): `sign({ operations,
                           accountName, role })` → discriminated outcome
                           `signed` (SignResult) | `cancelled` | `needsClassicReauth`
                           (privateKey session lacks a key at-or-above the floor
                           — open the EXISTING classic re-auth dialog) |
                           `error` (dialogless-path failure). Routing is by
                           SESSION KIND: 'privateKey' → the hook module's
                           STATIC legacy signer (built once at module load —
                           the signer is stateless: WIF getter + steem-js, ZERO
                           registry dependency) with NO dialog, NO pre-check,
                           NO extra network calls, and RUNTIME-INDEPENDENT by
                           contract (round-1 review P2): privateKey signing
                           must keep working while the vault runtime is loading
                           AND when IndexedDB is unavailable, exactly like the
                           pre-T2 SteemSigner path — do NOT reintroduce a
                           runtime dependency here and do NOT add a silent
                           SteemSigner fallback (effective role = the LOWEST
                           session key at-or-above the floor, mirroring
                           useActiveSigningKey — e.g. posting→active→owner for
                           the claim banner's posting floor); 'vault' → the
                           runtime's vaultSigner
                           through `<VaultSigningDialog>` (returned as
                           `signing.dialog`, mount it once per surface — this
                           path DOES need the runtime/IndexedDB by design).
                           ONE in-flight request per surface across BOTH
                           paths; host unmount resolves `cancelled`. Never
                           build another signer at a component; never query
                           /api/query/accounts outside the vault signer.
                           A6-T3b NOTE — two deliberate direct-signing
                           remnants, both "the signing key exists in NO
                           session": the claim banner's device-remembered
                           posting-key restore (#375/#378, privateKey sessions
                           only) still signs via `SteemSigner.signClaimRewardBalance`
                           with the restored key, and communities-section's
                           hivemind setup ops still sign via
                           `SteemSigner.signOperations` with the NEW community
                           owner's freshly derived active key
src/components/vault/import-key-dialog.tsx  R2 add-key dialog: account / role
                           (four options, native select) / WIF / note / vault
                           password (encrypts THAT ONE key only). Two-phase
                           submit — local validateVaultWif (WIF -> public key;
                           the WIF never leaves the component) ->
                           verifyKeysOnChain (public key + account only) ->
                           result box (warnings amber, most consequential
                           finding wins: not-on-chain > sub-threshold >
                           authority-differs-from-selected-role [R3 batch: e.g.
                           memo selected but posting matched — stored under the
                           SELECTED role, so never a green "verified"] > memo >
                           matched) -> explicit confirm ->
                           manager.addKey. Duplicate detection = public
                           directory (account, role) count before vs after the
                           call (the service's no-op leaves it unchanged;
                           account names compared through
                           normalizeSteemUsername, never a raw ===) ->
                           keyAlreadyExists banner. WIF discipline: transient
                           form state only, scrubbed on success/cancel/unmount,
                           never Redux/logs/analytics/network
src/components/vault/vault-empty-dialog.tsx  A5 three-option empty state
                           (create / import / continue browsing)
src/components/vault/unlock-vault-dialog.tsx  A5 unlock (existing password only —
                           no strength policy on unlock; per-key era meaning:
                           authenticate + select the vault in this tab's session)
src/components/vault/key-confirmation-dialog.tsx  A5+R1 post-create/import backup
                           acknowledgment: password loss unrecoverable, on-chain
                           keys unaffected, AND (R1, four locales) account names /
                           roles / notes are public in storage and backups —
                           never put secrets in a note
src/components/vault/work-mode-events.ts  R3 leaf module holding
                           VAULT_WORK_MODE_OPEN_EVENT (re-exported by
                           app-layout.tsx for the historical import path) and
                           VAULT_WORK_MODE_CLOSED_EVENT (dispatched by
                           app-layout whenever the modal closes — the single
                           close path, Esc/outside clicks are blocked) — lets
                           the login surfaces open the modal and react to its
                           closing without an import cycle (layout -> header
                           -> login form -> vault login form -> layout)
src/components/auth/login-form.tsx  R3 MODE DISPATCHER (`LoginForm`): reads the
                           persisted signing mode via useVaultRuntime +
                           useSigningMode. 'vault' -> VaultLoginForm — including
                           embedded dialogs that only declare
                           `requiredAuthTypes` (the market / proposals /
                           witnesses sign-in dialogs since A6-T4: the floor
                           applies to the privateKey branch, and after identity
                           login the per-action password dialog enforces it);
                           'vault' + embedded ACCOUNT-PINNED re-auth
                           (`fixedUsername`) -> explicit "not available in
                           Vault Mode yet" notice + Work Mode shortcut. A6-T4
                           narrowing: `requiredAuthTypes` alone no longer
                           triggers the notice — identity selection + the
                           per-key password path CAN satisfy an authority
                           floor, so the notice is reserved for account-pinned
                           re-auth (a privateKey session that needs ITS
                           account's key back; identity selection would switch
                           accounts). The permissions key reveal keeps the
                           notice PERMANENTLY — showing the raw WIF can never
                           be served by the signing path. Since A6-T3a NO
                           wallet-action re-auth gate fires for a page-matching
                           vault session (wallet-transfers-modals hands it
                           every hosted form directly); the migrated wallet
                           forms' own in-form re-auth dialogs (delegate / power
                           up / power down / market / proposals / creator /
                           remove / witness) remain as the defensive path for
                           the divergent mode/session edge (a privateKey
                           session that lost its key); EVERY other state
                           (privateKey, mode still loading, failed read,
                           runtime unavailable, no provider) -> the
                           module-private PrivateKeyLoginForm, whose body is
                           byte-identical to the pre-R3 LoginForm (the R3 diff
                           is insert-only)
src/components/auth/vault-login-form.tsx  R3 identity selection: two NATIVE
                           selects — vaults (manager.listVaults) and the
                           selected vault's account names (manager.getAccounts,
                           the locked-readable outer directory; no IVs / notes
                           rendered; accounts holding NO key are not offered —
                           such an identity could never sign). Default =
                           active vault, else the first;
                           selections are DERIVED in render (explicit choices
                           keyed by vault — a vault switch drops the account
                           choice); directory loads are sequence-guarded and
                           keyed by (vaultName, retry generation) so a slow
                           response for a previously selected vault never
                           lands; A6-T6: the vault-LIST loads carry the SAME
                           sequence guard (a slow earlier listVaults response
                           — success or failure — is dropped when a newer
                           refresh has landed, and unmount invalidates
                           in-flight loads). Empty states: no vault -> create/import
                           entry, empty vault -> add-a-key hint (both dispatch
                           VAULT_WORK_MODE_OPEN_EVENT), storage/runtime/
                           directory errors -> vault.errors.* + Retry, NEVER a
                           PrivateKey fallback. Directory-change refresh: the
                           list + directory are re-read on
                           VAULT_WORK_MODE_CLOSED_EVENT (in-modal management)
                           and on visibilitychange -> visible (other tabs),
                           stale-while-revalidate (a refreshNonce re-triggers
                           the read WITHOUT entering the result key, so no
                           loading flash; still-valid choices survive, a
                           removed account / vault drops its choice). Submit =
                           ACTIVATE the selected vault (A6-T2: a settings-row
                           write so the signer's session-vault -> active-vault
                           resolution finds the identity's vault; failure only
                           logs) + dispatch setVaultIdentity + navigate (or
                           onLoginSuccess when embedded): no unlock, no
                           decryption, no challenge/login, no network
src/lib/store/slices/auth.ts  R3: `sessionKind?: 'privateKey' | 'vault'` (OPTIONAL
                           — absent = 'privateKey', so every pre-R3 AuthState
                           value stays valid; read via sessionKindOf);
                           setCredentials writes 'privateKey'; setVaultIdentity
                           ({ username }) writes 'vault' and forces all six key
                           fields null (wipes any previous privateKey session's
                           keys); logout resets to the initial privateKey state
src/hooks/use-auth.ts      R3: logout of a 'vault' session clears ONLY the Redux
                           identity — no /api/auth/logout (the session never
                           logged in server-side) and no Legacy remembered
                           username / posting key read, write or delete
src/components/home/home-redirect-or-login.tsx  R3: waits for the signing mode;
                           'vault' skips the Legacy remembered-username jump
                           (the remembered keys are not even read); privateKey,
                           unavailable runtime and failed reads keep the
                           historical jump
src/lib/auth/legacy-private-key-signer.ts  privateKey-mode signer (A4): injected WIF
                           getter (WIRED since A6-T1 — see session-key-source.ts),
                           deliberately NO authority pre-check
                           (A6 acceptance: default privateKey behavior unchanged)
src/lib/auth/session-key-source.ts  A6-T1 login-state WIF getter for the legacy signer:
                           reads ONLY the Redux auth slice's per-role key fields
                           (owner/active/posting — NO fallback to the `privateKey`
                           compat field) for the logged-in account (sameSteemAccount
                           match), at signing time; vault sessions hold no keys by
                           construction so they fail closed to VAULT_KEY_INVALID;
                           never reads the Legacy remembered (localStorage) keys;
                           no store singleton exists, so providers.tsx binds the app
                           store via bindSessionKeyStore (store-access decision
                           documented in the module header)
src/lib/vault/backup.ts    Backup layer, four-field envelope era: exportVaultBackup
                           (portable envelope + lastBackupAt CAS), importVaultBackup
                           (single-password contract, per-key re-encryption — each
                           source WIF is decrypted and immediately re-encrypted,
                           plaintext never accumulated; instance-bound
                           adoption/rollback), mergeVaultBackup (requires the target
                           selected on the SAME service instance — matched via
                           the shared comparison key, so a case-variant name
                           resolves the same vault; a target with zero key
                           ciphertext rejects VAULT_EMPTY BEFORE any password
                           is used; target-first
                           dedupe on (accountName, role, publicKey); target keys are
                           decrypted ONLY to authenticate/dedupe — winning target
                           ciphertext preserved byte-identically; source keys
                           re-encrypted under the target KEK with fresh IVs;
                           preMergeBackup snapshot; any failure leaves the target
                           byte-identical)
tests/fixtures/vault-development-test-vectors.json   fixed test vectors (byte-identical
                           copy of the reviewed source; TEST-ONLY keys/passwords):
                           the two-key hierarchy (alice posting + active), shared
                           salt, per-key IV/ciphertext/length vectors, fresh-IV
                           re-encryption vector, emptyEnvelope, kekHex
tests/unit/vault-contract.test.ts    6 cases: hierarchy/shared-salt/public-notes pins,
                           exact per-key crypto values, retired flat/root-ciphertext
                           fields asserted ABSENT
tests/unit/vault-r1-contract.test.ts 2 cases: accepts the per-key envelope; REJECTS
                           the retired whole-payload envelope (no parallel format)
tests/unit/vault-envelope.test.ts    29 cases: base64url round-trip/canonical,
                           rejection matrix (field sets, roles, IV uniqueness,
                           account uniqueness), resource cases (A1+A1.1+R1)
tests/unit/vault-crypto.test.ts      11 cases: vectors recomputed for real (shared
                           KEK, both per-key ciphertexts, re-encryption), IV
                           freshness/exclusion, argument + availability contracts
tests/unit/vault-validation.test.ts  62 cases: alias/password/account tables +
                           MOCK-driven WIF branches (A1.1 — mock proves branches
                           only, NOT real checks; unchanged by R1)
tests/unit/vault-registry.test.ts    20 cases: atomic uniqueness, NFC/case collisions,
                           CAS, settings pointer moves, fail-closed storage (A2,
                           retargeted at the hierarchical record)
tests/unit/vault-service.test.ts     11 cases: pointer-session lifecycle, locked
                           public directory, per-key add/remove/note semantics,
                           cross-tab invalidation (hard line + broadcast),
                           shuffle-stable per-case state (R1)
tests/unit/vault-backup.test.ts      16 cases: export round-trip + CAS-stale
                           propagation, import boundaries, rollback races
                           (remove+recreate stand-down, removal-failure
                           residual), empty-source import, merge dedupe/
                           failure-atomicity with different source/target
                           passwords, empty-target VAULT_EMPTY rejection,
                           case-variant target matching (A3+R1)
tests/unit/vault-manager.test.ts     21 cases: manager surface, merge WITHOUT
                           pre-unlock via targetPassword (locked:true, lockEpoch+1,
                           preMergeBackup), changePassword incl. the empty-vault
                           rejection and cross-tab
                           interleavings, rename/remove/export (A4+R1)
tests/unit/vault-signer.test.ts      31 cases: authority pre-check branches, IV-
                           selected-key contract (wrong password / unknown IV /
                           role-scoped selection), key selection/coverage/
                           threshold, frozen-tx integrity, recover_account
                           exclusion, legacy signer (A4+R1)
tests/unit/signing-facade.test.ts    6 cases: mode dispatch, no fallback, persistence
                           (A4; requests now carry keyIv/vaultPassword)
tests/unit/work-mode-switcher.test.tsx  7 cases: dual options + Legacy badge,
                           signed-out render, in-place switch, failure keeps the
                           previous mode + maps codes, busy state (A5)
tests/unit/vault-manager-panel.test.tsx  21 cases: list/empty-dialog/create/
                           unlock/export/delete/merge — merge reachable on a
                           LOCKED target with the target-password field +
                           preMergeBackup delivery, storage-unavailable retry,
                           row-menu -> key-manager view, VAULT_EMPTY scene
                           routing (changePasswordEmpty / mergeTargetEmpty, R3
                           batch) (A5+R1+R2, mocked manager/facade)
tests/unit/vault-key-management.test.ts  20 cases: single sorted deduped fresh
                           batch query, full-key_auths scan (second entry),
                           sub-threshold/memo/not-on-chain results, privilege
                           priority, malformed-pair skipping, degraded/
                           missing/malformed/fetch fail-closed (incl. the
                           missing / non-string memo_key typeof branch),
                           empty-input no-network, candidate shape rejections
                           (R2)
tests/unit/vault-key-manager.test.tsx   18 cases: locked-state directory
                           rendering, empty hint, add flow (matched/
                           sub-threshold/not-on-chain/verification-failure/
                           local-validation), idempotent already-stored banner,
                           remove confirmation with the account+role+IV
                           pointer, note editing, rendered-tree leak
                           assertions; R3 batch: WIF scrub on cancel / Esc
                           dismiss / whole-view unmount, authority-differs
                           verdict (both directions, warn tone; sub-threshold
                           outranks it), normalized added-vs-duplicate count
                           (R2, mocked manager + verifyKeysOnChain)
tests/unit/vault-login-form.test.tsx    19 cases (R3): vault list -> account
                           directory data flow, default active vault / first
                           vault, switch clears the account choice (also on
                           switching back), keyless accounts not offered,
                           slow stale directory response
                           discarded (mutation-checked against the sequence
                           guard), no-vault / empty-vault entries firing the
                           Work Mode event, list / directory / runtime errors
                           mapped + Retry with no private-key input anywhere,
                           submit -> sessionKind 'vault' with all key fields
                           null, NO unlock / challenge / login / fetch,
                           embedded onLoginSuccess, no IV / note rendering,
                           directory-change refresh (modal closed: no-vault ->
                           created vault, empty vault -> added keys, stale-
                           while-revalidate keeping a valid choice, removed
                           account dropping it; visibilitychange for other
                           tabs) — the refresh wiring is mutation-checked
tests/unit/app-layout-work-mode.test.tsx  2 cases (R3): open event opens the
                           modal, the X close dispatches the CLOSED event, the
                           historical OPEN re-export still matches
tests/unit/login-form-dispatch.test.tsx 10 cases (R3): REAL useSigningMode over a
                           mocked facade — privateKey -> classic form, vault ->
                           VaultLoginForm (plain + embedded pass-through),
                           embedded fixedUsername / requiredAuthTypes ->
                           unsupported notice + Work Mode event, privateKey
                           embedded re-auth unchanged, loading / unavailable /
                           failed read -> classic form
tests/unit/home-redirect-or-login.test.tsx  6 cases (R3): privateKey jump kept,
                           vault mode skips the jump without reading the
                           remembered key, waits while the runtime loads,
                           unavailable / failed read keep the default jump
tests/unit/auth-slice.test.ts + use-auth.test.tsx  R3 additions: sessionKind
                           writes, setVaultIdentity nulls every key field (also
                           wiping a previous privateKey session), sessionKindOf
                           default, vault logout with no server call and NO
                           Legacy localStorage access (spied on jsdom's Storage
                           prototype). login-form-reauth.test.tsx is
                           deliberately UNCHANGED — it renders LoginForm with
                           no VaultProvider and still passes (PrivateKey path
                           untouched)
tests/unit/vault-i18n-errors.test.ts  4 cases: error-code -> i18n table completeness
                           across all four locales (A5)
tests/e2e/vault-mode.spec.ts  2 cases, REAL browser IndexedDB + Web Crypto:
                           no-reload mode switch + empty-state options; full
                           create -> confirm -> unlock/lock -> export download
                           lifecycle (A5; structure-agnostic, still valid)
tests/mocks/fake-indexeddb.ts        hand-written in-memory IndexedDB fake (A2) — see
                           fidelity notes under Pitfalls
tests/node/vault-wif-real-check.mjs  plain-`node` real-crypto WIF verification (A1.1;
                           reads vectors.vault.keys[0]; not part of `pnpm test` —
                           run manually when touching WIF logic)
```

The authoritative product spec lives outside the repo: the vault development
kickoff task package (2026-10-31) for the original contracts, and the R1–R3
handoff task package (agent-share, 2026-11-05) §4 as the CURRENT authority for
the V1 hierarchical shape and its non-negotiable rules. The type contracts in
`types.ts` must stay field-compatible with the handoff's structure.

## Invariants — do not break these

1. **V1 hierarchical envelope, per-key ciphertext.** The root carries exactly
   `version / vaultName / salt / accounts` (`ENVELOPE_FIELDS`); every account
   exactly `accountName / keys`; `keys` exactly the four role arrays
   `owner / active / posting / memo`; every key `iv / ciphertext / note`
   REQUIRED plus an OPTIONAL `publicKey` (non-empty string when present —
   outer PUBLIC data persisted since 2026-11-13 so the locked key manager can
   display and dedupe keys without decrypting; entries written before the
   field existed stay valid without it, and no unknown field is tolerated).
   No root `iv`/`ciphertext`, no flat `keys[]` payload, no `wrappedDataKey`, no
   hidden `vaultId`, no public `accountNames` sidecar, no "unlock an old vault
   to build a directory" step. The retired whole-payload envelope is REJECTED by
   `validateVaultEnvelope` — pinned by `tests/unit/vault-r1-contract.test.ts`;
   never maintain a parallel format. Account names are unique after
   `normalizeSteemUsername`; key IVs are unique across the ENTIRE vault (the IV
   is the key-selection pointer).
2. **Outer metadata is public — and never authority.** Account names, roles,
   IVs, notes and the outer `publicKey` are visible while LOCKED
   (`service.getAccounts` /
   `getEnvelope` / `getRecordSnapshot` resolve session vault → active vault
   with no password) and appear in cleartext in every backup. The UI must keep
   warning users never to put secrets in a note (four locales,
   `keyConfirmWarningPublicNotes`). Publicly visible metadata is never treated
   as proof of on-chain authority — signing re-fetches the chain (invariant 19).
3. **One password, one shared salt, fresh random IV per encryption.** A vault
   has exactly one password and one shared salt (no per-key passwords). KEK =
   PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte salt, 32-byte KEK;
   AES-GCM-256, 12-byte IV, AAD `steem-wallet.vault.v1` (`VAULT_AAD`),
   128-bit tag appended (WebCrypto-native). IVs are CSPRNG-random, never
   derived from the password; every new encryption under the same KEK mints a
   fresh IV (`encryptVaultKeyRecord` skips `excludedIvs`; envelope validation
   enforces vault-wide uniqueness) — re-encrypting the same WIF must always
   produce a new IV (the fixture's `reencryption` vector pins this). The AAD
   binds the FORMAT, not key identity: a ciphertext cut-and-pasted to another
   account/role still decrypts, which is BY DESIGN — preventing misplaced
   authority is the signer's on-chain authority pre-check's job (invariant
   19), so never add account/role material to `VAULT_AAD` (it would break
   every existing ciphertext). All parameters are exported constants, not
   literals; the fixture pins the exact KEK and per-key ciphertexts —
   touching a parameter must fail the vector tests, and that is correct.
4. **No global WIF-unlocked state.** The service session is a NON-SENSITIVE
   `VaultRevisionPointer` (name + `createdAt`/`revision`/`lockEpoch`) — no KEK
   and no plaintext key ever live in the session closure. `unlock` derives the
   KEK, authenticates by decrypting exactly ONE key (the first found) +
   `validateVaultWif`, then zeroizes the KEK and keeps only the pointer.
   Signing decrypts existing keys only for the ONE key selected by `keyIv`.
   Two further decryption surfaces exist and are DELIBERATE — know them
   before "optimizing" them away: `addKey` and `mergeVaultBackup` transiently
   decrypt existing keys one at a time solely to derive public keys for
   authentication/dedupe (these probes never rewrite the winning ciphertext;
   entries already carrying the outer publicKey field are compared as plain
   strings instead of being decrypted), and `changePassword` decrypts each
   key only to immediately re-encrypt it under the fresh-salt KEK (carrying
   the key's outer publicKey over verbatim — dropping it there would erase
   the field on every password change). Every such path clears each
   plaintext before touching the next key and must never form a state where
   all WIFs are simultaneously in memory.
5. **Signing carries `keyIv` + `vaultPassword`; everything is cleared before
   broadcast.** `SignOperationsRequest` / `SignResolvedTransactionRequest`
   select the exact encrypted key by `(accountName, role, keyIv)` and carry the
   vault password for that one operation — no unlock is required or formed.
   The signer scrubs in `finally`: `request.vaultPassword = ''`, `kek.fill(0)`,
   the WIF reference dropped — so the returned `SignResult` (with
   `locked: true`, always) and the subsequent relay broadcast happen with
   nothing decrypted in memory; a broadcast failure never replays
   automatically. Signing never writes the vault record (tests pin
   byte-identical records and scrubbed request fields).
6. **Fail closed, everywhere.** Unknown envelope version, wrong field count at
   any level, non-base64url characters, NON-CANONICAL base64url (trailing-bit
   aliases, padded forms), salt ≠ 16 B, key IV ≠ 12 B, ciphertext below the
   16-byte GCM-tag floor, duplicate key IV, duplicate normalized account name
   → `VAULT_ENVELOPE_INVALID`. GCM authentication failure (wrong password /
   tampered / wrong AAD — indistinguishable by design) →
   `VAULT_PASSWORD_INVALID`. `crypto.subtle` missing →
   `VAULT_CRYPTO_UNAVAILABLE`, guarded per entry point (derive/encrypt/decrypt
   and separately getRandomValues) *before* any await.
7. **Sensitive/public type boundary.** `VaultSigningSession`,
   `VaultKeyInput.privateKey` / `.password` and the request `vaultPassword` are
   SENSITIVE: they may only exist inside one operation's scope — never in
   Redux, logs, analytics, network requests or caller components.
   `VaultSummary` / `VaultAccountSummary` / `VaultKeySummary` (`role`, `iv`,
   `note`, `publicKey | null`) / `SignResult` are PUBLIC and must stay free
   of key material (an outer `publicKey` is inherently public — the chain
   publishes it at verification time).
   Error messages never contain password, ciphertext, KEK or WIF fragments
   (tests assert this).
8. **`memo` is stored but never signs.** `SigningRole =
   Exclude<VaultKeyRole, 'memo'>`; `requireSigningRole` rejects `memo` with
   `VAULT_KEY_INVALID`; the signer's key selection scans signing roles only.
9. **Canonical base64url only (A1.1).** Every binary envelope field must
   satisfy `encodeBase64Url(decodeBase64Url(value)) === value`; exactly one
   encoding per byte sequence is valid. Canonical encoding + vault-wide IV
   uniqueness together make the base64url IV a safe string key for selecting
   keys — do not reintroduce multi-form idempotency.
10. **Shared validation entry points (A1.1).** Alias, password, account-name
    and WIF rules live ONLY in `src/lib/vault/validation.ts` — never
    re-implement at a call site or only in the UI. Aliases: NFC display value
    stored, uniqueness key `NFC(name).toLowerCase()` (`vaultNameComparisonKey`),
    1–64 code points measured on BOTH the raw input and its NFC form, no
    trimming, no leading/trailing whitespace, no Cc/Cf/Cs/Zl/Zp code points;
    legally paired astral characters pass. Password policy (≥14 code points,
    versioned common-password blocklist, not the normalized account name, not
    the same-flow master password) runs ONLY in create / independent-import /
    change-password — unlocking, export and deletion must keep accepting the
    existing password. WIF checks delegate to the real
    `steem.auth.isWif`/`getPublicKey` and normalize account names through the
    shared `normalizeSteemUsername` (never a bare `toLowerCase`).
11. **Resource boundaries are module constants, enforced in the validators.**
    `envelope.ts` exports the single source of truth: raw envelope JSON ≤ 1 MiB
    (`parseVaultEnvelopeJson` checks before `JSON.parse`), per-key ciphertext
    ≤ 1 MiB (encoded-length pre-check before decode, decoded length re-checked),
    serialized envelope UTF-8 ≤ 1 MiB, ≤ 400 key entries, ≤ 100 accounts.
    Over-limit → `VAULT_LIMIT_EXCEEDED` (NOT `VAULT_ENVELOPE_INVALID`);
    structural violations keep their own codes. Create/import/validate paths
    all call the same validators — do not re-derive bounds at call sites.
12. **Fixture discipline.** `tests/fixtures/vault-development-test-vectors.json`
    is a byte-identical copy of the reviewed source file (keep it identical to
    the agent-share copy). Crypto tests **recompute** the vectors (derive the
    shared KEK, re-encrypt both WIFs, compare byte-for-byte) — never assert the
    fixture's boolean flags. `vault-contract.test.ts` pins exact values AND
    asserts the retired flat-payload / root-ciphertext fields are absent.
13. **No new runtime dependencies.** Everything uses browser Web Crypto. (The
    dapp phase will add `@steemit/steem-uri` — deferred, not part of A*/R*.)
14. **Session identity is `(vaultName, createdAt, revision, lockEpoch)` (A2).**
    Every session-bound operation re-reads the record and compares ALL FOUR —
    the `createdAt` binding is what stops remove + same-name-recreate from
    resetting counters to 0/0 and colliding with a live session (a stale tab
    would otherwise CAS-overwrite the recreated vault's ciphertext — permanent
    corruption, found in review). Known residual window: same-millisecond
    recreate still collides (`Date.now()` granularity); closing it fully needs
    a random per-record id, deferred to a future `VaultRecordV1` schema
    version. In the per-key era the session is only a pointer, but the same
    hard line applies to CAS writers (`commitAccounts`, `swapRecord` callers).
15. **IndexedDB transaction discipline (A2).** Inside a `readwrite` transaction
    callback, only IDB request promises may be awaited — never a macrotask
    boundary (real IDB auto-commits and then throws `TransactionInactiveError`;
    the fake reproduces this). Uniqueness check + write happen in ONE
    transaction; if the callback throws, the transaction is aborted (no partial
    writes). The comparison key is scanned via `getAll` — it is never persisted
    into `VaultRecordV1` and never part of the AAD.
16. **Cross-tab invalidation is two-layered (A2).** The hard line is the
    per-operation freshness re-read (invariant 14); `BroadcastChannel`
    (`VAULT_DB_NAME`) is acceleration only and the code must keep working with
    it absent. `lock()` clears the session pointer first, then persists
    `lockEpoch + 1`, then broadcasts — the broadcast runs in a `finally`, so a
    failed persistence still notifies other tabs. `lock()` on a
    concurrently-removed vault propagates `VAULT_NOT_FOUND` (the pointer is
    already cleared) — callers must tolerate that code.
17. **Payload commits are CAS and fail-closed.** `service.commitAccounts(
    expected, accounts)` validates the FULL hierarchical envelope before the
    CAS write (`revision + 1`, fresh `updatedAt`); a `VAULT_SESSION_STALE` /
    `VAULT_NOT_FOUND` failure drops the in-memory session pointer; success
    advances it to the new revision and broadcasts `vault-mutate`. The registry
    independently re-validates `next` via `vaultRecordToEnvelope` before any
    write request. Note there is no mutator callback channel anymore: the
    service primitives (`addKey` / `removeKey` / `updateKeyNote` /
    `commitAccounts`) take structured, already-encrypted data — never
    reintroduce a `mutatePayload`-style API that hands decrypted WIFs to
    caller-supplied callbacks.
18. **Merge blueprint hard contract (target-password era).** Manager-level
    merge does NOT require a pre-unlocked target: `importVaultDetailed`
    authenticates `targetPassword` itself (an unlock probe — derive +
    authenticate one key, keeping only the pointer — when no session on the
    target exists; an existing session is reused as-is and the password is
    still verified by the merge's own per-key target decryption).
    `mergeVaultBackup` requires the target selected on the SAME service
    instance, snapshots a memory-only `preMergeBackup` (does not touch
    `lastBackupAt`), decrypts target keys ONLY to authenticate and dedupe —
    the winning target entries keep their original ciphertext bytes — and
    re-encrypts source keys under the TARGET KEK with fresh IVs, deduping on
    `(accountName, role, publicKey)` with TARGET entries winning. Any failure
    leaves the target record byte-identical. Success → `service.lock()` (the
    manager hard contract: `locked: true`, `lockEpoch + 1`; a lock-persistence
    failure still cleared memory and propagates), and the `preMergeBackup`
    flows out through `importVaultDetailed` — the UI must deliver it (file
    download or an explicit discard) before claiming the pre-migration backup
    is done; the memory-only snapshot alone is not a completed backup. A
    target that holds NO key ciphertext is rejected with `VAULT_EMPTY` BEFORE
    any password is used (2026-11-05 ruling: an empty vault has no password
    anchor, so nothing could authenticate `targetPassword` — proceeding would
    silently re-key the vault under whatever was typed; add a key to the
    target or do an independent import instead). An empty or fully-duplicate
    SOURCE still commits once (`revision+1` via CAS — deliberate, do not add
    an equality short-circuit) while every target ciphertext byte is
    preserved; only genuinely new keys are re-encrypted with fresh IVs.
    `importVault` (the A0-shaped method) drops the `preMergeBackup`; merge
    flows must use `importVaultDetailed`.
19. **Authority pre-check and traffic contract.** Per signing request: the
    op→authority classifier (19 relay ops in `OPERATION_AUTHORITY_CLASSES` +
    payload-based `account_update`/`custom_json`; unknown ops →
    `VAULT_OPERATION_UNSUPPORTED`), then ONE sorted batched
    `fetchAccounts(..., { fresh: true })` (bypasses browser L1 only — the
    server-side cache governance stays intact); `degraded`/missing
    accounts/malformed authority/fetch failure → `VAULT_AUTHORITY_UNAVAILABLE`
    with ZERO signing calls. The requested role is a FLOOR; key selection
    scans the FULL `key_auths` of every level at-or-above the floor
    (owner > active > posting downward coverage) and requires the selected
    key's weight ALONE to meet `weight_threshold` (sub-threshold keys fail
    closed — no multi-key signing yet). Outer vault metadata never substitutes
    for this check. The legacy privateKey signer deliberately has NO pre-check
    (A6 acceptance: default privateKey behavior unchanged).
20. **`recover_account` stays excluded; `privateKey` stays the default.**
    `recover_account` is deliberately unsupported through the facade/signers
    (`VAULT_OPERATION_UNSUPPORTED`): it needs old+new owner dual signatures
    (2026-10-08 incident, `tx_missing_other_auth`); recovery flows keep the
    dedicated dual-key path in `client.ts` — do not route them into the vault
    signer until multi-key signing exists. The facade's settings-backed
    signing mode defaults to `privateKey`.
21. **A vault identity is a SELECTION, never an authentication (R3).** Vault
    Mode "login" picks a vault + account from the locked-readable public
    directory and dispatches `auth/setVaultIdentity({ username })`: the
    session gets `sessionKind: 'vault'`, `isAuthenticated: true` and ALL six
    key fields null (`setVaultIdentity` forcibly wipes any key material left by
    a previous privateKey session). The flow never unlocks, never decrypts a
    key, never calls `/api/auth/challenge` / `/api/auth/login` (or any other
    network endpoint), and never reads, writes or removes the Legacy
    remembered username / posting key. The action carries no key material,
    so the DevTools sanitizers (`auth/setCredentials` only) need no change —
    keep it that way: a vault identity must never grow key fields. Logout of
    a vault session is local-only (Redux; no `/api/auth/logout`, Legacy
    localStorage untouched). Consequences for callers:
    - An identity proves NOTHING about key possession: signing still needs the
      per-key password path (invariant 5) and the on-chain pre-check
      (invariant 19). Nothing may treat `isAuthenticated` of a vault session
      as "keys are available" — `useActiveSigningKey()` correctly returns null.
      Since A6-T2 a vault session SIGNS through `useSessionSigning`
      (`sessionKind`-routed; see the module map) — the transfer flow is the
      pilot; nothing else may hand-roll a parallel path.
    - The login surface is chosen by the persisted mode (`LoginForm`
      dispatcher). Only a POSITIVELY read `'vault'` mode renders vault
      surfaces; every other state renders the PrivateKey form (persisted
      default; login must not hard-depend on IndexedDB). Inside Vault Mode the
      reverse holds: storage errors show mapped errors + Retry, never a silent
      PrivateKey fallback.
    - Embedded ACCOUNT-PINNED re-auth callers (`fixedUsername`) cannot be
      satisfied by identity selection (it would switch accounts) and get an
      explicit "not available in Vault Mode yet" notice with a Work Mode
      shortcut. Since A6-T4 `requiredAuthTypes` ALONE no longer triggers the
      notice: the market / proposals / witnesses sign-in dialogs declare the
      active floor for the PRIVATEKEY branch while Vault Mode keeps identity
      selection — the per-key password path enforces the floor after login,
      so identity selection IS fit for purpose for vault mode now. The
      permissions key reveal keeps the notice PERMANENTLY (it needs the raw
      WIF displayed, which the signing path never exposes). Since A6-T3a NO
      wallet-action re-auth gate fires for a page-matching vault session
      (wallet-transfers-modals shows every hosted form directly — transfer,
      power up/down, cancel power down, delegate, withdraw routes, convert —
      and each form signs through the per-key password path); since A6-T3b
      the claim-rewards banner's re-auth dialog is likewise unreachable for a
      vault session; since A6-T4 the witness-vote login dialog (which used to
      conditionally pin `fixedUsername` and could surface the notice) opens
      only for unauthenticated visitors and no T4 surface reaches the notice
      for an authenticated vault session.
      Migrating a caller = routing its action through useSessionSigning and
      dropping its notice reachability — never a silently degraded form.
    - The claim-rewards banner's device-remembered posting-key restore
      (#375/#378) is a privateKey-session affordance ONLY: `handleClaim` skips
      it when `sessionKindOf(auth)` reads `'vault'`, so a vault session never
      reads the Legacy remembered key (let alone signs with it). Since A6-T3b
      the session-key cases sign through `useSessionSigning` at the posting
      floor (privateKey: posting → active → owner, the #378 session-key
      chain; vault: the per-key password dialog, never the re-auth dialog /
      its notice); the remembered-key branch keeps signing DIRECTLY with the
      restored key (it sits between posting and active in the resolution
      order and exists in no session the unified entry could read). Pinned in
      `tests/unit/claim-rewards-banner.test.tsx` (spied on jsdom's Storage
      prototype; mutation-checked against the un-gated restore).
    - Scope of "never touches the Legacy remembered keys": the vault login
      and logout flows and every key-resolution path a vault session can
      reach. Two pre-existing, non-key touches are deliberate and remain:
      (a) while the signing mode is still being read, the transient classic
      form may READ the remembered USERNAME to prefill (no key read, no
      write); (b) a successful change-password clears the remembered posting
      key because the chain just invalidated it — a removal, never a borrow.
    - Known UX gaps: NONE left for vault sessions. The historical list, all
      CLOSED: the `delegate-form` "Not authenticated" dead-end for a keyless
      vault session CLOSED in A6-T3a (with the seven other wallet-op callers
      — see the A6 progress note below; the transfer-form's copy of that gap
      CLOSED in A6-T2); the claim-rewards / communities / change-password /
      recovery-warning vault gaps (keyless notice or dead gate) CLOSED in
      A6-T3b — the claim banner's "skip restore → re-auth dialog →
      vaultUnsupported notice" chain is gone and each of the four callers
      signs through the per-key password path; the market / proposals /
      witnesses gap CLOSED in A6-T4 — those sign-in dialogs now declare
      `requiredAuthTypes: ['active']` (every action on the three pages is
      active-class) without pinning a username, Vault Mode keeps identity
      selection there, and an authenticated vault session orders / votes /
      creates / removes / witness-votes straight through the per-key password
      path instead of reopening the login dialog. The one PERMANENT notice
      consumer is the permissions key reveal (raw WIF display — outside the
      signing path by design).
22. **Plaintext migration is user-initiated and gated on a verified readback
    (A6-T5).** Moving the device-remembered posting key
    (`wallet:rememberedPostingKey`) into the vault is an EXPLICIT user action
    (the key manager's "Migrate remembered key" button, rendered only while a
    valid remembered pair exists) — nothing auto-migrates. The localStorage
    plaintext is deleted ONLY after (a) `service.addKey` wrote the key
    encrypted (fresh IV, password authentication, dedupe no-op on
    (accountName, role, publicKey)), (b) the record was RE-READ from the
    registry (`service.getRecordSnapshot` — a fresh IndexedDB read, never the
    write path's in-memory record), and (c) the specific stored entry was
    AUTHENTICALLY DECRYPTED (AES-GCM under the password-derived KEK and the
    re-read record's salt) with the public key derived from the decrypted WIF
    matching the flow-start derivation. Write success alone NEVER deletes.
    The gate lives in `migrateRememberedPostingKey`
    (src/lib/vault/migration.ts, exposed on the manager) — the ONLY
    `clearRememberedPostingKey` call in the MIGRATION FLOW; migration UI code
    never re-implements it or deletes on its own. Failure semantics: any
    failure (wrong password, vanished/changed
    remembered pair, readback mismatch, storage error) leaves the plaintext
    untouched; a partial success (key written, readback failed) leaves BOTH
    the vault entry and the plaintext, and the flow is idempotent — re-running
    rides addKey's dedupe no-op, verifies, then deletes (`alreadyPresent`).
    The readback runs on BOTH outcomes — the no-op dedupe (outer-publicKey
    string match) proves nothing about decryptability, so `alreadyPresent`
    still re-reads and authenticate-decrypts before deleting (pinned by the
    corrupt-duplicate test in tests/unit/vault-migration.test.ts).
    EMPTY-TARGET ANCHORING (r1 P1-1): a zero-key vault cannot authenticate
    any password, so a migration into it makes the typed password the vault's
    password — and a success then deletes the only other copy of the key.
    The bar is CREATION-LEVEL in that case: the dialog renders a CONFIRMED
    re-typed password (mirroring the create-vault form) and runs the full
    `validateVaultPassword` policy (with the remembered account as context);
    the PRIMITIVE independently re-checks the policy for the anchoring case
    before the write (defense-in-depth — a rogue caller cannot anchor a weak
    password even with the dialog bypassed). Non-empty targets keep the
    single verify field and never re-run the policy (unlock-path passwords
    keep working).
    DELETION-POINT HARDENING (r1 P2 + P3-1): immediately before the deletion
    the plaintext is re-read and must STILL be the exact flow-start WIF (a
    mid-flow swap aborts with VAULT_KEY_INVALID, no deletion); immediately
    after, a post-condition read must find it GONE (a storage error that
    clearRememberedPostingKey swallowed surfaces as VAULT_STORAGE_UNAVAILABLE,
    never as a success).
    What stays: the remembered USERNAME is NOT deleted (a public account
    name; it keeps the classic login prefill, the remembered-username
    redirect and the switch-back-to-privateKey UX working — deleting it would
    degrade that UX with zero security gain). Consequence for consumers: the
    claim banner's device-restore (#375/#378) simply finds nothing after a
    migration (its gate reads the same localStorage key) — pinned in
    tests/unit/claim-rewards-banner.test.tsx and
    tests/unit/vault-migration.test.ts; switching the device mode back to
    privateKey keeps a fully working classic login (the form never depended
    on the remembered key — pinned in tests/e2e/vault-migration.spec.ts).
    Migration entry data is PUBLIC: the dialog holds only the account name,
    the derived public key and the typed vault password — never the WIF (the
    primitive re-reads localStorage inside the gated operation).
    Scope note on "the only clearRememberedPostingKey call": that is the
    MIGRATION FLOW's contract — clearRememberedPostingKey has pre-existing
    legitimate callers outside it (change-password-section clearing a key the
    chain just invalidated, and the logout device-auth clear); those are
    unrelated to this invariant.

## Error taxonomy (17 codes, types.ts order)

`VAULT_NAME_EXISTS` · `VAULT_NOT_FOUND` · `VAULT_EMPTY` · `VAULT_MODE_REQUIRED` ·
`VAULT_OPERATION_UNSUPPORTED` · `VAULT_LOCKED` · `VAULT_PASSWORD_INVALID` ·
`VAULT_ENVELOPE_INVALID` · `VAULT_PAYLOAD_INVALID` · `VAULT_SESSION_STALE` ·
`VAULT_STORAGE_UNAVAILABLE` · `VAULT_CRYPTO_UNAVAILABLE` ·
`VAULT_NAME_INVALID` · `VAULT_PASSWORD_WEAK` · `VAULT_KEY_INVALID` ·
`VAULT_LIMIT_EXCEEDED` · `VAULT_AUTHORITY_UNAVAILABLE`. Messages are English,
machine-routed via `code` (UI text goes through i18n) and never echo names,
passwords, WIFs, ciphertext or payload. Per-key-era reading of the
whole-envelope-era codes: `VAULT_PAYLOAD_INVALID` now fires only on the stored
settings row (corrupt/unknown shape); `VAULT_LOCKED` means "no vault is
selected in this session", not "WIFs are sealed" — there is no WIF-bearing
session anymore; `VAULT_EMPTY` covers both "nothing to resolve" (no session
and no active vault) and the empty-vault password-anchor rejections (merge
into, or changePassword on, a vault with zero key ciphertext).

## Pitfalls already hit

- **jsdom crypto is Node's webcrypto itself.** Unlike the `localStorage` case in
  `tests/setup.ts`, nothing shadows it — `globalThis.crypto === window.crypto`
  in vitest jsdom, `subtle` and `getRandomValues` just work. Do not add setup
  workarounds.
- **`globalThis.crypto` is a configurable getter.** To test the unavailability
  path, `Object.defineProperty` a replacement and restore the *original
  descriptor* in afterEach (the established pattern in `vault-crypto.test.ts`).
  Verified stable under shuffled and single-test runs.
- **PBKDF2 600k costs ~0.5–0.8s per derivation.** Share derived KEKs via
  `beforeAll` (`vault-crypto.test.ts` now derives exactly 2 — correct + wrong);
  suites that must derive per-case (service/manager/signer/backup) carry
  explicit 20–60 s timeouts. Single `addKey`/`unlock`/`sign` calls each derive
  once or twice — budget UI pending states accordingly.
- **base64url MUST be canonical (closed in A1.1).** Trailing-bit aliases are
  rejected (`encodeBase64Url(decodeBase64Url(value)) === value`, else
  `VAULT_ENVELOPE_INVALID`), so envelope fields — including per-key IVs — have
  exactly one valid encoding and may be string-compared directly (key
  selection depends on this). Do not reintroduce multi-form idempotency.
- **Resource caps: two-stage size checks.** The per-key ciphertext cap checks
  the ENCODED string length (≤ `VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS`) BEFORE
  decoding, so an oversized field never allocates its decoded bytes; the
  decoded length is then re-checked. `parseVaultEnvelopeJson` and the
  serialized-envelope cap use the same trick: a cheap UTF-16-unit proxy (UTF-8
  bytes are always ≥ code units) rejects obviously oversized text, then
  `TextEncoder` gives the exact byte count for multi-byte inputs that slip
  under the unit bound.
- **WIF verification is two-layer (A1.1 discipline).** Under vitest,
  `@steemit/steem-js` is aliased to `tests/mocks/steem-js.ts` (`isWif` → always
  true, `getPublicKey` → fake), and the real `isWif` cannot run in vitest jsdom
  anyway (`@noble/hashes` 2.x rejects the Node Buffers steem-js passes in — see
  AGENTS.md MAIN-60). Therefore: vitest tests only prove branches/error codes;
  REAL checksum/derivation/vector comparison evidence comes from
  `tests/node/vault-wif-real-check.mjs` (reads `vectors.vault.keys[0]`), run
  with plain `node` (never registered in `pnpm test`). Rerun that script
  whenever WIF handling changes.
- **Unicode property escapes (`\p{Cc}` etc.) need an ES2018+ runtime** — same
  baseline as the Web Crypto API the vault depends on, so acceptable. Keep the
  `u` flag on.
- **Duplicated byte constants.** salt/iv/tag sizes are defined on both envelope
  and crypto sides, locked together by consistency assertions in
  `vault-envelope.test.ts`. If you add a third consumer, prefer importing from
  `crypto.ts` over redefining.
- **jsdom has no IndexedDB but DOES have Node's BroadcastChannel (A2).**
  Registry tests therefore run against `tests/mocks/fake-indexeddb.ts`
  (hand-written, no new dependency); the "no broadcast" path is exercised by
  explicitly hiding the global. Fake fidelity bounds (documented in its
  header): no abort rollback (an `abortCount()` hook makes abort calls
  observable instead), no versionchange/blocked negotiation, FIFO transaction
  queue. Real-browser semantics were proven separately in review via
  Playwright + real Chromium/IndexedDB — rerun such golden checks when the
  transaction discipline itself changes, not for every edit.
- **Sequential re-selection is safe; interleaved unlocks are last-writer-wins
  (R1).** `unlock` now LOCKS any previous session first (`if (session !== null)
  await lock()`), so switching vaults costs one `lockEpoch` bump on the old
  one — do not "optimize" that away. Genuinely concurrent (interleaved) unlock
  calls still resolve last-writer-wins; single-tab UI never races them. If a
  future flow allows it, serialize explicitly.
- **Empty-vault password semantics are DECIDED (2026-11-05 ruling).** With
  zero key ciphertext (empty `accounts`, or every role array empty) there is
  no key to probe, so `service.unlock` accepts ANY non-empty password for an
  empty vault — the pass-through stays (pinned). The flip side is fail-closed:
  `mergeVaultBackup` into an empty target and `changePassword` on an empty
  vault both reject `VAULT_EMPTY` BEFORE any password is used — an empty
  vault has no password anchor, and the password of the NEXT `addKey` is the
  real one. `addKey` into an empty vault stays allowed (R2 main path; a typo
  introduced there can be corrected by changePassword once a key exists), and
  an independent import of an empty source creates a fresh empty vault — the
  recovery path the merge rejection's message points at.
- **Rename leaves a lingering session pointer (KNOWN WRINKLE, pinned in
  `vault-manager.test.ts`).** After `renameVault`, an existing session still
  names the OLD record: session-bound reads fail `VAULT_NOT_FOUND`, and the
  next `unlock` first tries to lock the renamed-away record and fails once
  with `VAULT_NOT_FOUND` — but `lock()` clears memory BEFORE the persist, so
  the stale pointer is gone and the retry succeeds. Pinned, not endorsed.
- **A failed merge retains the authenticated session.** If `mergeVaultBackup`
  throws AFTER the manager's `targetPassword` unlock probe succeeded (e.g.
  wrong SOURCE password, CAS stale), the post-merge `service.lock()` never
  runs and the session pointer survives — the panel keeps showing the target
  as unlocked. Harmless security-wise (the pointer holds no key material) but
  inconsistent with the post-merge-lock story; do not build UX that assumes
  merge failure ⇒ locked. The same asymmetry exists on FAILED
  `changePassword` paths that throw after the authenticating `unlock`
  succeeded (empty-vault `VAULT_EMPTY` rejection, weak new password, CAS
  stale in the capture→CAS window): the final `service.lock()` is skipped and
  the session survives — while a WRONG old password ends the previous session
  locked (the unlock locks the prior session before deriving). Qualified in
  the R1 review round as a known non-security asymmetry (the session is a
  non-sensitive pointer); pinned here so future UX does not assume failure ⇒
  locked for either flow.
- **The public directory is readable while locked — by design (R1 semantic
  change).** `getAccounts` / `getEnvelope` / `getRecordSnapshot` resolve
  session vault → active vault with no password; R2 locked-state browsing and
  R3 identity selection depend on it. Do not "harden" these reads back behind
  an unlock.
- **Vault tests must stay shuffle-stable (A2 standard).** `vault-service.test.ts`
  rebuilds fake + registry + service in `beforeEach` and shares only
  `beforeAll` KEKs — that is the pattern to copy for new lifecycle suites.
- **Vault-mode users may see the PrivateKey form for one frame (R3,
  deliberate).** The `LoginForm` dispatcher renders the classic form until the
  stored mode positively reads `'vault'` (see invariant 21) — the price of
  never gating PrivateKey login on IndexedDB. The mode read is one settings
  get on an already-open registry, so the swap is near-instant; do NOT "fix"
  it with a loading gate in front of the classic form (that regresses the
  PrivateKey path and breaks the provider-less `login-form-reauth` suite).
- **Selections are derived, not synced by effects (R3).** The
  `react-hooks/set-state-in-effect` lint rule forbids synchronous `setState`
  in effect bodies. `VaultLoginForm` therefore stores only EXPLICIT user
  choices (vault choice; account choice keyed by vault) and derives the
  effective selection during render (active vault / first vault fallback,
  account choice valid only for the current vault and directory). Directory
  loads write state only from their async callbacks, gated by a sequence ref
  and keyed by `(vaultName, retry generation)`. Copy this pattern instead of
  "repair the selection in an effect".
- **jsdom `Storage` spying under Node >= 22.4.** Node ships its own experimental
  `Storage` global, so `vi.spyOn(Storage.prototype, ...)` may not intercept
  jsdom's `localStorage`. Spy on `Object.getPrototypeOf(localStorage)` instead
  (use-auth / home-redirect R3 tests).
- **A cleanup exit exists for unreadable stored records (R1).** Devices that
  ran the never-shipped A5 whole-vault build keep records the per-key format
  rejects (`VAULT_ENVELOPE_INVALID` on load). There is still NO migration
  layer (2026-11-05 ruling); the sanctioned recovery path is
  `registry.purgeInvalidVaultRecords` / `manager.cleanupUnreadableVaults`,
  offered by the panel ONLY on a `VAULT_ENVELOPE_INVALID` load failure and
  gated behind an explicit user confirmation. Confirming is a
  DOWNLOAD-THEN-PURGE sequence: the dialog first snapshots the raw rows via
  `manager.listUnreadableVaultRecords` (each entry carries the primary key,
  the raw display name and the VERBATIM stored value) and delivers them as a
  `steem-wallet-incompatible-vault-records-<timestamp>.json` download — a
  failed snapshot or download ABORTS the purge — and only then deletes. The
  copy is archival/debugging only: this version cannot re-import it. The
  purge deletes only rows the standard validation rejects and resets a
  dangling `activeVaultName`; do not wire it into normal flows or widen the
  deletion verdict beyond the shared validation path.

## Extension checklist

- **R1 has landed on this branch** — consume `envelope.ts` / `crypto.ts` /
  `registry.ts` / `service.ts` / `backup.ts` / `manager.ts` / `signer.ts` /
  `signing-facade.ts` as-is; do not bypass them with direct IndexedDB access
  or ad-hoc crypto. Invariants 1–22 above are the contract. The branch must
  land as ONE PR targeted at `next` covering the whole R1–R3 arc (handoff §5
  step 5) — do not split.
- **R2 (key management + notes) has landed on this branch** — settled
  decisions future work must preserve:
  - `src/lib/vault/key-management.ts` is a READ-ONLY orchestration seam (the
    R1 service primitives `addKey` / `removeKey` / `updateKeyNote` are
    untouched and remain the only writers); it receives WIF-FREE candidates
    and answers with `{matched, authority, weight, threshold, suffices}` per
    candidate. Verification results are ADVICE: sub-threshold and
    not-on-chain keys are storable with warnings (2026-11-05 ruling), the
    signer keeps failing closed (invariant 19).
  - Locked-state browsing renders `manager.getAccounts` output directly —
    never gate it behind an unlock (invariant 2).
  - The add-key password encrypts THAT ONE key only; the WIF lives solely in
    the dialog's transient state (scrubbed on success/cancel/unmount) and
    the vault's internal primitives — never Redux, logs, analytics, network.
  - Idempotent dedupe rides `service.addKey`'s no-op (duplicate publicKey in
    the role → unchanged record); the UI detects it by comparing the public
    directory's (account, role) key count before vs after the call and shows
    an "already stored" banner.
  - Removal locates keys by account + role + IV behind an explicit confirm
    and needs NO vault password (it only deletes ciphertext).
  - New i18n surface: `vault.keys*` / `vault.addKey*` / `vault.verify*` /
    `keyAdded` / `keyAlreadyExists` keys plus the scene-level
    `mergeTargetEmpty` / `changePasswordEmpty` (VAULT_EMPTY inside those two
    forms is always the empty-vault password-anchor scene — the generic
    errors-table message stays for "nothing to resolve"). All four locales,
    locked symmetric by i18n-symmetry + vault-i18n-errors (the new keys live
    in the `vault` namespace, NOT the errors table, so the bidirectional
    code lock is unaffected).
- **R3 (no-unlock identity login) has landed on this branch** — settled
  decisions future work must preserve (invariant 21 is the contract):
  - `LoginForm` is a pure mode DISPATCHER; the classic flow lives in the
    module-private `PrivateKeyLoginForm`, whose body is byte-identical to the
    pre-R3 `LoginForm` (the R3 diff of that file is insert-only). Do not edit
    the classic body as part of vault work, and do not export it — every
    caller must go through the dispatcher.
  - Mode resolution: only a POSITIVELY read `'vault'` renders vault surfaces;
    loading / failed read / unavailable runtime / missing provider render the
    PrivateKey form (persisted default, no hard IndexedDB dependency for
    login). `HomeRedirectOrLogin` instead WAITS for the mode before its
    Legacy remembered-username jump (so a vault user is never redirected by
    PrivateKey-era device data) and skips the jump entirely in Vault Mode.
  - Embedded ACCOUNT-PINNED re-auth (`fixedUsername`) + Vault Mode =
    the explicit `vaultUnsupported*` notice with a Work Mode shortcut —
    chosen over "silently guide to identity selection" because identity
    selection would switch accounts and cannot hand a specific session its
    key back. Since A6-T4 `requiredAuthTypes` ALONE no longer triggers the
    notice: the market / proposals / witnesses sign-in dialogs declare the
    active floor for the privateKey branch while Vault Mode keeps identity
    selection (the per-action password dialog enforces the floor after
    login). Final status after A6-T4: NO business-action surface reaches
    the notice for an authenticated vault session; the only remaining
    consumers are the account-pinned re-auth dialogs' divergent
    mode/session edge (a privateKey session that lost its key while the
    device mode says vault) and the permissions key-reveal notice, which
    stays PERMANENTLY (revealing a key must display the raw WIF,
    which the signing path never exposes). Plain embedded usage
    (header / market / proposals login modals) gets VaultLoginForm.
  - `sessionKind` is OPTIONAL on `AuthState` (absent = 'privateKey') so every
    pre-R3 AuthState value stays valid; read it via `sessionKindOf`.
  - `VAULT_WORK_MODE_OPEN_EVENT` (and the new `VAULT_WORK_MODE_CLOSED_EVENT`)
    live in the leaf module `src/components/vault/work-mode-events.ts`
    (app-layout re-exports the OPEN one). Import the leaf from any component
    that the layout itself renders, or you recreate the layout -> header ->
    login form import cycle.
  - Directory-change refresh: vault-derived views OUTSIDE the modal re-read on
    `VAULT_WORK_MODE_CLOSED_EVENT` (every management action happens inside
    the modal) plus `visibilitychange` for other tabs — deliberately NOT by
    listening to the service's BroadcastChannel (its `vault-mutate` /
    `vault-lock` messages are a private cross-tab acceleration protocol, and
    registry-level create / rename / remove / import never broadcast). Keep
    refreshes stale-while-revalidate (no loading flash, valid choices kept).
  - New i18n surface: `auth.vault*` (16 keys: selects, helper, loading,
    no-vault / empty-vault / unsupported copy) plus `vault.verifyAuthorityDiffers`
    (R2 batch), all four locales.
- **A6 progress — the vault-session signing path EXISTS (A6-T2 pilot +
  A6-T3a wallet-ops batch + A6-T3b remaining wallet callers + A6-T4
  market/proposals/witnesses) and the caller migration is COMPLETE; the
  A6-T5 plaintext migration (remembered posting key -> vault) has LANDED**
  (src/lib/vault/migration.ts + the key manager's "Migrate remembered key"
  entry + tests/e2e/vault-migration.spec.ts; deletion gate = invariant 22;
  the claim banner's remembered-key restore now coexists with a device whose
  key moved into the vault — post-migration it finds nothing and the vault
  password path takes over) — the
  privateKey backend has been wired into the facade since A6-T1
  (`vault-manager.tsx` composes
  `createLegacyPrivateKeySigner(createSessionKeyGetter())`, which reads the
  logged-in account's Redux session keys — see
  `src/lib/auth/session-key-source.ts`), and since A6-T2:
  (a) `useSessionSigning` (see the module map) is the ONE consumer signing
  entry — `transfer-form` was the A6-T2 pilot caller; A6-T3a migrated the
  eight active-class wallet-operation callers (delegate-form,
  delegations-section revoke, power-up-form, power-down-form,
  cancel-power-down-handler, convert-sbd-form, savings-withdraw-history,
  withdraw-routes-form — each builds its operation tuples INLINE,
  byte-identical to the retired SteemSigner.* builders, role floor
  'active'); A6-T3b migrated the remaining four wallet-domain callers
  (claim-rewards-banner at the posting floor, communities-section
  account_create at 'active' + community subscribe custom_json at 'posting',
  change-password-section account_update at 'owner', recovery-warning-banner
  change_recovery_account at 'owner') with the same byte-identical tuples —
  the two role floors other than 'active' exercise the hook's full
  posting→active→owner / owner-only resolution, and each caller's own key
  gate widens for a page-matching vault session (claim banner hint,
  communities activeKeyRequired, recovery owner-key notice) while keyless
  privateKey sessions keep the PRE-EXISTING gates for those three callers —
  for change-password the `ownerKeySessionRequired` gate is NEW: pre-T3b the
  flow had no gate at all, because the signing key was derived from the
  form's account password. KEY-SOURCE CHANGE (T3b, deliberate): through the
  unified entry the privateKey path signs with the SESSION owner key, so a
  privateKey session WITHOUT one (e.g. an active-WIF login that knows the
  master password) now gets explicit re-authenticate guidance instead of the
  old silent success with the form-derived owner key — re-authenticating
  with the master password or owner WIF derives the very same owner key, so
  the signed transaction is unchanged once the session holds it. A6-T4
  migrated the LAST five business callers (market-page-client
  limit_order_create/limit_order_cancel, proposals-page-client
  update_proposal_votes, proposal-creator-dialog create_proposal,
  proposal-remove-dialog remove_proposal, witness-vote-form
  account_witness_vote/account_witness_proxy) — all ACTIVE-floor (NOTE:
  update_proposal_votes is active-class on Steem, matching the pre-T4
  active-or-owner key resolution and the legacy postingOps whitelist which
  never listed it), byte-identical tuples, each caller's action gate widened
  to "authenticated session" (vault sessions act through the password
  dialog; the witness login dialog's conditional fixedUsername — the last
  business `vaultUnsupported` notice reachability — retired), and the
  market/proposals/witnesses sign-in dialogs now declare
  `requiredAuthTypes: ['active']` so a privateKey login is fit for purpose
  the first time. Every
  privateKey path signs through the hook's STATIC
  legacy signer — NO pre-check, NO extra network calls, and NO
  vault-runtime/IndexedDB dependency, a round-1-review hard contract; every
  vault path opens the per-key password dialog, and
  `wallet-transfers-modals` hands a page-matching vault session EVERY
  wallet action directly (the classic re-auth gate stays for mismatched
  sessions and keyless privateKey sessions).
  Direct `SteemSigner` consumers after A6-T4 — FINAL "who still signs
  directly" inventory, no business callers remain: PERMANENT/deliberate =
  login-form (challenge + key derivation), the two recovery pages
  (`signRecoverAccount` dual-sign — invariant 20),
  recover-account-step-1-page verify helpers + account-keys.ts +
  change-password.ts validation helpers (derive/validate only, never
  broadcast), claim-rewards-banner's remembered-key branch and
  communities-section's hivemind setup ops (keys that exist in no session —
  see the module map note under use-session-signing). The seven T4 builders
  (`signLimitOrderCreate` / `signLimitOrderCancel` /
  `signUpdateProposalVotes` / `signCreateProposal` / `signRemoveProposal` /
  `signWitnessVote` / `signWitnessProxy`) now have NO production callers —
  deleting them (with the rest of the retired builder batch) is a separate
  cleanup decision. Never build a signer
  at a component; never query `/api/query/accounts` outside the vault
  signer.
  (b) R3 vault sessions (`sessionKind: 'vault'`, zero keys in Redux) sign per
  operation through `VaultSigningDialog`: the encrypted key is selected by
  `(accountName, role, keyIv)` from the public directory, the vault password
  is asked once per operation, and no wallet-action re-auth gate shows the
  embedded `vaultUnsupported*` notice for a page-matching vault session
  (the remaining notice consumers are listed under invariant 21).
  (c) VaultLoginForm submit now ACTIVATES the selected vault (settings-row
  write, no unlock/decrypt/network) — the signer resolves its record through
  session vault -> ACTIVE vault, so the identity's vault must be the active
  one for signing to work; a settings-write failure does not block the login
  (signing surfaces map the later VAULT_EMPTY).
- **Work-mode UI wiring rules (A5, still current):** the composition root is
  `getVaultRuntime()` in `vault-manager.tsx` — a MODULE-LEVEL SINGLETON
  (registry + manager + facade); consume `useVaultRuntime()` /
  `<VaultProvider>`, never build another runtime. Mode is a DEVICE PREFERENCE
  (settings row; the switcher works signed-out; `useSigningMode` updates in
  place — no page refresh). Surface ALL VaultErrors through
  `vault.errors.<CODE>` i18n keys (17 codes + `unexpected`, four locales,
  pinned by `tests/unit/vault-i18n-errors.test.ts`) — never render
  `error.message`. The B-phase dapp hook is reserved: dispatching
  `VAULT_WORK_MODE_OPEN_EVENT` (exported from app-layout.tsx) opens the modal
  and focuses the mode switcher (`#work-mode-switcher`). `changePassword` on
  an already-session-selected vault bumps `lockEpoch` by +2 (the unlock's
  switch-lock +1, final lock +1) and a WRONG old password also ends the
  previous session locked — surface both. `exportVaultBackup` CAS-writes
  `lastBackupAt`; the revision bump invalidates sessions in ANY tab (the
  manager already locks this tab's session first).
- **jsdom notes for tests:** radix DropdownMenu opens via keyboard
  (ArrowDown), not click; `File#text()` does not exist in jsdom (the UI uses a
  FileReader helper); modal dialogs aria-hide the rest of the page, so
  Playwright role queries must target the dialog itself or use CSS locators.
- **New vault tests**: follow the fixture-recompute discipline; never copy
  WIFs or passwords into `src/`. Anything touching WIF handling needs BOTH
  layers: mock-driven vitest cases plus a rerun of
  `tests/node/vault-wif-real-check.mjs` recorded in the PR body.
