# 09 — Vault (encrypted multi-account wallet)

> Status date: 2026-11-05. **R1 (hierarchical per-key encryption) LANDED on this
> branch** — `feat/vault-per-key-hierarchy`, three commits on top of
> `origin/next@cee626a2` (work-mode modal), HEAD `3752c10e`. The branch is NOT
> merged into `next` and no PR exists yet; everything below is branch-only until
> that PR lands. Tracking issue: #381.
> History: A0–A5 (PRs #382, #383, #386, #387, #389, #390, #391 and the modal
> follow-up `cee626a2`) shipped a whole-envelope implementation that was never
> released; R1 replaced it directly with the approved V1 hierarchical structure
> — **no migration layer, by decision** (the old format never survived a
> release, so there is nothing to migrate). Covers what has landed: type
> contracts, error taxonomy, V1
> hierarchical envelope validation, per-key Web Crypto, shared input validation
> with resource boundaries, the registry/service/backup layers, the manager +
> signer + unified facade, and the A5 work-mode UI (mode switcher, vault manager
> panel, empty/unlock/key-confirmation dialogs) updated for the per-key contract.
> Not implemented: R2 (key-management UI, locked-state browsing), R3 (no-unlock
> identity login), A6 caller migration, and the B-phase dapp — this doc grows
> with each task package.

## Module map

```
src/lib/vault/types.ts     Type contracts only — zero runtime code. V1 shapes:
                           VaultEnvelopeV1 = { version, vaultName, salt, accounts }
                           with per-key VaultKeyCiphertext { iv, ciphertext, note }
                           under four role arrays (VaultRoleKeys); PUBLIC summaries
                           (VaultSummary / VaultAccountSummary / VaultKeySummary —
                           role + iv + note, no key material); SENSITIVE
                           VaultSigningSession (per-operation only); signing
                           requests carry keyIv + vaultPassword; ImportVaultParams
                           merge variant carries targetPassword; the 17 error codes
src/lib/vault/errors.ts    VaultError (code + English message); codes come from types.ts
src/lib/vault/envelope.ts  base64url codec (canonical-only) + V1 HIERARCHICAL
                           validation: exact field sets at all three levels
                           (root / account / key), exactly four role arrays,
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
                           (accountName / role / iv / note) needs no password.
                           commitAccounts = full-envelope-validate + CAS payload
                           write; addKey (password-authenticated insert, fresh IV,
                           duplicate publicKey detected by decrypting the role's
                           existing keys — no write on duplicate); removeKey
                           (located by account + role + IV); updateKeyNote (note
                           edit, ciphertext untouched); BroadcastChannel as
                           acceleration layer only
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
                           changePassword: authenticate old -> policy-check new ->
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
src/hooks/use-signing-mode.ts   A5 mode-state hook wrapping the facade's
                           getSigningMode/setSigningMode: success updates local
                           state in place (never reloads), failure rethrows with
                           the previous mode still displayed
src/components/vault/work-mode-switcher.tsx  A5 PrivateKey/Vault dual selector
                           (radiogroup) — device preference, works signed-out;
                           PrivateKey carries the Legacy/Deprecated badge
src/components/vault/vault-manager.tsx  A5+R1 composition root + panel:
                           VaultProvider/getVaultRuntime (module-singleton
                           registry + manager + facade — one tab = one session
                           service), VaultManagerPanel (vault list / create /
                           import / merge / rename / change-password / delete /
                           export). MERGE FORM SEMANTICS (R1): the dialog asks
                           for the backup password AND the TARGET vault
                           password, is reachable and submittable on a LOCKED
                           target (no pre-unlock step; the retired
                           mergeRequiresUnlock gate is gone), and the completion
                           dialog enforces download-or-explicit-discard of the
                           preMergeBackup plus the post-merge LOCKED notice
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
src/lib/auth/legacy-private-key-signer.ts  privateKey-mode signer (A4): injected WIF
                           getter (A6 wiring point), deliberately NO authority pre-check
                           (A6 acceptance: default privateKey behavior unchanged)
src/lib/vault/backup.ts    Backup layer, four-field envelope era: exportVaultBackup
                           (portable envelope + lastBackupAt CAS), importVaultBackup
                           (single-password contract, per-key re-encryption — each
                           source WIF is decrypted and immediately re-encrypted,
                           plaintext never accumulated; instance-bound
                           adoption/rollback), mergeVaultBackup (requires the target
                           selected on the SAME service instance; target-first
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
tests/unit/vault-backup.test.ts      10 cases: export round-trip, import boundaries
                           and rollback races, merge dedupe/failure-atomicity with
                           different source/target passwords (A3+R1)
tests/unit/vault-manager.test.ts     20 cases: manager surface, merge WITHOUT
                           pre-unlock via targetPassword (locked:true, lockEpoch+1,
                           preMergeBackup), changePassword incl. cross-tab
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
tests/unit/vault-manager-panel.test.tsx  18 cases: list/empty-dialog/create/
                           unlock/export/delete/merge — merge reachable on a
                           LOCKED target with the target-password field +
                           preMergeBackup delivery, storage-unavailable retry
                           (A5+R1, mocked manager/facade)
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
   `owner / active / posting / memo`; every key exactly `iv / ciphertext / note`.
   No root `iv`/`ciphertext`, no flat `keys[]` payload, no `wrappedDataKey`, no
   hidden `vaultId`, no public `accountNames` sidecar, no "unlock an old vault
   to build a directory" step. The retired whole-payload envelope is REJECTED by
   `validateVaultEnvelope` — pinned by `tests/unit/vault-r1-contract.test.ts`;
   never maintain a parallel format. Account names are unique after
   `normalizeSteemUsername`; key IVs are unique across the ENTIRE vault (the IV
   is the key-selection pointer).
2. **Outer metadata is public — and never authority.** Account names, roles,
   IVs and notes are visible while LOCKED (`service.getAccounts` /
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
   produce a new IV (the fixture's `reencryption` vector pins this). All
   parameters are exported constants, not literals; the fixture pins the exact
   KEK and per-key ciphertexts — touching a parameter must fail the vector
   tests, and that is correct.
4. **No global WIF-unlocked state.** The service session is a NON-SENSITIVE
   `VaultRevisionPointer` (name + `createdAt`/`revision`/`lockEpoch`) — no KEK
   and no plaintext key ever live in the session closure. `unlock` derives the
   KEK, authenticates by decrypting exactly ONE key (the first found) +
   `validateVaultWif`, then zeroizes the KEK and keeps only the pointer. Only
   signing decrypts existing keys, and only the ONE key selected by `keyIv`.
   Add / independent-import / merge / changePassword re-encrypt key-by-key
   (decrypt → re-encrypt → clear before the next key) and must never form a
   state where all WIFs are simultaneously in memory.
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
   `note`) / `SignResult` are PUBLIC and must stay free of key material.
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
    is done; the memory-only snapshot alone is not a completed backup. An
    empty/no-change source still rewrites the record (fresh IVs, `revision+1`)
    — deliberate, do not add an equality short-circuit. `importVault` (the
    A0-shaped method) drops the `preMergeBackup`; merge flows must use
    `importVaultDetailed`.
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
session anymore.

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
- **Empty-vault unlock semantics are UNDECIDED (flagged, not pinned).** With
  `accounts: []` there is no key to probe, so `service.unlock` accepts ANY
  non-empty password for an empty vault (`authenticate` returns early). No test
  pins this either way and the handoff (§7) lists it as an open contract
  question — decide it deliberately before R2/R3 UI leans on
  unlock-for-empty-vault; do not silently harden or rely on it.
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
  merge failure ⇒ locked.
- **The public directory is readable while locked — by design (R1 semantic
  change).** `getAccounts` / `getEnvelope` / `getRecordSnapshot` resolve
  session vault → active vault with no password; R2 locked-state browsing and
  R3 identity selection depend on it. Do not "harden" these reads back behind
  an unlock.
- **Vault tests must stay shuffle-stable (A2 standard).** `vault-service.test.ts`
  rebuilds fake + registry + service in `beforeEach` and shares only
  `beforeAll` KEKs — that is the pattern to copy for new lifecycle suites.

## Extension checklist

- **R1 has landed on this branch** — consume `envelope.ts` / `crypto.ts` /
  `registry.ts` / `service.ts` / `backup.ts` / `manager.ts` / `signer.ts` /
  `signing-facade.ts` as-is; do not bypass them with direct IndexedDB access
  or ad-hoc crypto. Invariants 1–20 above are the contract. The branch must
  land as ONE PR targeted at `next` covering the whole R1–R3 arc (handoff §5
  step 5) — do not split.
- **R2 (key management + notes) is next — scope and acceptance live in the
  R1–R3 handoff task package (agent-share, 2026-11-05) §5 step 3.** Pointers:
  - New UI: `src/components/vault/vault-key-manager.tsx` +
    `import-key-dialog.tsx` wired into `vault-manager.tsx`
    (`src/lib/vault/key-management.ts` only if a lib seam is genuinely
    needed — `service.addKey` / `removeKey` / `updateKeyNote` already exist).
  - Locked-state browsing renders the public directory (accounts, roles, key
    counts, outer notes) with NO unlock; add-key form fields: account, role,
    WIF, note, vault password — the password is used for that one encryption
    only.
  - On-chain association check: ONE `/api/query/accounts` `fresh: true` query,
    scan ALL `key_auths` per role, compare `memo_key` for memo.
  - Idempotent dedupe on `(accountName, role, publicKey)` — `service.addKey`
    already returns the unchanged record when the role already holds the
    public key (it decrypts the role's existing keys to compare).
  - Removal locates the key by account + role + IV with an explicit second
    confirmation; removing a role's last key drops the account entry
    (`service.removeKey`).
  - Legally-valid-but-sub-threshold keys may be STORED with a warning; the
    signer keeps failing closed on them (invariant 19) until multi-key
    signing exists.
  - WIF lives only in the dialog's transient state and vault internals —
    cleared on success/cancel/unmount; never Redux, logs, analytics, network.
- **R3 (no-unlock identity login) — handoff §5 step 4.** Pointers: new
  `src/components/auth/vault-login-form.tsx` (two native selects fed by the
  outer `accounts` directory); `login-form.tsx` becomes a mode dispatcher
  (PrivateKey behavior unchanged); `auth` slice gains `setVaultIdentity` +
  `sessionKind: 'vault'` with all private/public key fields null; no
  challenge/login calls, no unlock, no decryption, no touching the Legacy
  remembered posting key; embedded `fixedUsername/requiredAuthTypes` flows
  still route through the per-key password + signing path (A6 wiring).
- **A6 (caller migration) still pending** — the privateKey backend is NOT
  wired into the facade yet (`vault-manager.tsx` injects only
  `manager.createSigner()`); until A6, facade privateKey signing fails with a
  TypeError and nothing routes signing through the facade. Components get ONE
  entry point when it happens: the `SigningFacade`, composed via
  `createVaultManager(registry)` + `manager.createSigner()` + the legacy
  signer with a login-state WIF getter. Never build a signer at a component;
  never query `/api/query/accounts` outside the vault signer.
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
