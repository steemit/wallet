# 09 — Vault (encrypted multi-account wallet)

> Status date: 2026-11-04, baseline `next@475b49a8` + A5 (PR #382 A0, PR #383 A1,
> A1.1 shared validation / canonical base64url / resource limits, PR #386 A2
> IndexedDB registry + unlock-session service, PR #387 A3 backup export /
> independent import / merge migration, PR #389 A4 manager / signer /
> signing facade, A5 work-mode drawer UI).
> Covers only what has landed: type contracts, error taxonomy, envelope validation,
> Web Crypto whole-envelope encryption, shared input validation with resource
> boundaries, the registry/service/backup layers, the manager + signer +
> unified facade, and the A5 work-mode UI (mode switcher, vault manager panel,
> empty/unlock/key-confirmation dialogs). Caller migration (A6) and the dapp
> phase (B0–B4) are not implemented yet — this doc grows with each task
> package. Tracking issue: #381.

## Module map

```
src/lib/vault/types.ts     Type contracts only — zero runtime code (A0, PR #382)
src/lib/vault/errors.ts    VaultError (code + English message); codes come from types.ts
src/lib/vault/envelope.ts  base64url codec (canonical-only since A1.1) + five-field
                           VaultEnvelopeV1 validation + raw-JSON parse entry point
                           + decrypted payload shape validation and the shared
                           resource-bound constants (A1 PR #383 + A1.1)
src/lib/vault/crypto.ts    PBKDF2 KEK derivation + AES-GCM whole-envelope encrypt/decrypt
                           + CSPRNG salt/iv generators (A1, PR #383)
src/lib/vault/validation.ts  Shared vault alias / password / account-name / WIF
                           validation + NFC display values + alias comparison key (A1.1)
src/lib/vault/registry.ts  IndexedDB layer (A2, PR #386): `steem-wallet-vault` v1 with
                           `vaults` (keyPath = NFC display name) + `settings` stores;
                           atomic alias uniqueness inside one readwrite transaction
                           (comparison key scanned via getAll — never persisted, never
                           in the AAD); revision/lockEpoch CAS; abort-on-callback-throw
src/lib/vault/manager.ts    VaultManager orchestration (A4, PR #389): the A0 ten
                           methods plus unlockVault/importVaultDetailed (preMergeBackup
                           handoff)/createSigner/destroy; merge -> service.lock() (the
                           blueprint post-merge lock contract); changePassword re-encrypts
                           with a fresh salt via swapRecord CAS (mutatePayload cannot
                           change salt) and locks after
src/lib/vault/signer.ts    Vault-mode signer (A4): op->authority table (19 relay ops +
                           account_update/custom_json payload-based, unknown ops rejected,
                           recover_account deliberately EXCLUDED — needs old+new owner
                           dual signatures, see client.ts signRecoverAccount), one sorted
                           batched authority fetch via accounts-client with fresh:true,
                           lowest-privilege key selection over ALL key_auths with
                           owner>active>posting downward coverage, memo never signs
src/lib/vault/signing-facade.ts  Mode dispatch (A4): settings-backed signingMode
                           (default privateKey), no silent fallback, backend errors
                           propagate verbatim
src/hooks/use-signing-mode.ts   A5 mode-state hook wrapping the facade's
                           getSigningMode/setSigningMode: success updates local
                           state in place (never reloads), failure rethrows with
                           the previous mode still displayed
src/components/vault/work-mode-switcher.tsx  A5 PrivateKey/Vault dual selector
                           (radiogroup) — device preference, works signed-out;
                           PrivateKey carries the Legacy/Deprecated badge
src/components/vault/vault-manager.tsx  A5 composition root + panel:
                           VaultProvider/getVaultRuntime (module-singleton
                           registry + manager + facade — one tab = one session
                           service), VaultManagerPanel (vault list / create /
                           import / merge with preMergeBackup delivery / rename /
                           change-password / delete / export), merge completion
                           dialog enforces download-or-explicit-discard
src/components/vault/vault-empty-dialog.tsx  A5 three-option empty state
                           (create / import / continue browsing)
src/components/vault/unlock-vault-dialog.tsx  A5 unlock (existing password only —
                           no strength policy on unlock)
src/components/vault/key-confirmation-dialog.tsx  A5 post-create/import backup
                           acknowledgment (password loss unrecoverable; on-chain
                           keys unaffected)
src/lib/auth/legacy-private-key-signer.ts  privateKey-mode signer (A4): injected WIF
                           getter (A6 wiring point), deliberately NO authority pre-check
                           (A6 acceptance: default privateKey behavior unchanged)
src/lib/vault/backup.ts    Backup layer (A3, PR #387): exportVaultBackup (five-field envelope
                           + lastBackupAt CAS), importVaultBackup (single-password contract,
                           instance-bound adoption/rollback), mergeVaultBackup (target-first
                           dedupe on (accountName, role, publicKey), preMergeBackup snapshot,
                           any failure leaves the target ciphertext byte-identical)
src/lib/vault/service.ts   Unlock-session service (A2, PR #386): createVaultService()
                           factory; KEK + payload live ONLY in the instance closure;
                           per-operation freshness re-read; BroadcastChannel as
                           acceleration layer only
tests/fixtures/vault-development-test-vectors.json   fixed test vectors (byte-identical
                           copy of the reviewed source; TEST-ONLY keys/passwords)
tests/unit/vault-contract.test.ts    fixture parseability + exact value pins
tests/unit/vault-envelope.test.ts    rejection matrix + canonical/resource cases (A1+A1.1)
tests/unit/vault-crypto.test.ts      vectors recomputed for real (16 cases)
tests/unit/vault-validation.test.ts  alias/password/account tables + MOCK-driven WIF
                           branches (A1.1 — mock proves branches only, NOT real checks)
tests/unit/vault-registry.test.ts    41 cases: atomic uniqueness, NFC/case collisions,
                           CAS, settings pointer moves, fail-closed storage (A2)
tests/unit/vault-service.test.ts     13 cases: unlock/lock lifecycle, cross-tab
                           invalidation (hard line + broadcast), mutate semantics,
                           shuffle-stable per-case state (A2)
tests/unit/vault-backup.test.ts      27 cases: export round-trip, import boundaries and
                           rollback races, merge dedupe/failure-atomicity (A3)
tests/unit/vault-manager.test.ts     20 cases: the ten methods, post-merge lock hard
                           contract, changePassword incl. cross-tab interleavings (A4)
tests/unit/vault-signer.test.ts      29 cases: authority pre-check branches, key
                           selection/coverage, frozen-tx integrity, recover_account
                           exclusion (A4)
tests/unit/signing-facade.test.ts    6 cases: mode dispatch, no fallback, persistence (A4)
tests/unit/work-mode-switcher.test.tsx  7 cases: dual options + Legacy badge,
                           signed-out render, in-place switch, failure keeps the
                           previous mode + maps codes, busy state (A5)
tests/unit/vault-manager-panel.test.tsx  15 cases: list/empty-dialog/create/
                           unlock/export/delete/merge incl. preMergeBackup
                           delivery, storage-unavailable retry (A5, mocked
                           manager/facade)
tests/unit/vault-i18n-errors.test.ts  error-code → i18n table completeness
                           across all four locales (A5)
tests/e2e/vault-mode.spec.ts  2 cases, REAL browser IndexedDB + Web Crypto:
                           no-reload mode switch + empty-state options; full
                           create → confirm → unlock/lock → export download
                           lifecycle (A5)
tests/mocks/fake-indexeddb.ts        hand-written in-memory IndexedDB fake (A2) — see
                           fidelity notes under Pitfalls
tests/node/vault-wif-real-check.mjs  plain-`node` real-crypto WIF verification (A1.1;
                           not part of `pnpm test` — run manually when touching WIF logic)
```

The authoritative product spec lives outside the repo (vault development kickoff task
package, 2026-10-31); the type contracts in `types.ts` were ported verbatim from its §2
and must stay field-compatible with it.

## Invariants — do not break these

1. **Whole-envelope encryption.** One vault = one encrypted payload
   (`{ keys: VaultKeyEntry[] }`). No per-key encryption, no `wrappedDataKey`, no hidden
   `vaultId`. First version unlocks wholesale: after unlock all WIFs live in the vault
   service memory, on lock everything is cleared in full (A2 will own that closure).
2. **Crypto parameters are exported constants, not literals.**
   PBKDF2-HMAC-SHA-256, 600,000 iterations, 16-byte salt, 32-byte KEK; AES-GCM-256,
   12-byte IV, AAD `steem-wallet.vault.v1` (`VAULT_AAD`), 128-bit tag appended
   (WebCrypto-native). Changing any of these invalidates every existing backup and the
   fixed vectors. The vectors in `tests/fixtures/` pin the exact KEK and ciphertexts —
   if you touch a parameter, those tests must fail, and that is correct.
3. **Sensitive/public type boundary.** `VaultUnlockSession`, `VaultPayloadV1`,
   `VaultKeyEntry.privateKey` are SENSITIVE: they may only exist inside the vault
   service closure — never in Redux, logs, analytics, network requests or caller
   components. `VaultSummary` / `VaultAccountSummary` / `SignResult` are PUBLIC and
   must stay free of key material. Error messages never contain password, ciphertext,
   KEK or WIF fragments (tests assert this).
4. **Fail closed, everywhere.** Unknown envelope version, wrong field count,
   non-base64url characters, NON-CANONICAL base64url (trailing-bit aliases,
   padded forms), salt ≠ 16B, iv ≠ 12B, ciphertext below the 16-byte GCM-tag
   floor → `VAULT_ENVELOPE_INVALID`. Bad payload shape →
   `VAULT_PAYLOAD_INVALID`. GCM authentication failure (wrong password /
   tampered / wrong AAD — indistinguishable by design) →
   `VAULT_PASSWORD_INVALID`. `crypto.subtle` missing →
   `VAULT_CRYPTO_UNAVAILABLE`, guarded per entry point
   (derive/encrypt/decrypt and separately getRandomValues) *before* any await.
5. **`memo` is stored but never signs.** `SigningRole = Exclude<VaultKeyRole, 'memo'>`;
   signing request types take `SigningRole` only.
6. **Fixture discipline.** `tests/fixtures/vault-development-test-vectors.json` is a
   byte-identical copy of the reviewed source file. Crypto tests **recompute** the
   vectors (derive the KEK, re-encrypt, compare byte-for-byte) — never assert the
   fixture's boolean flags. `vault-contract.test.ts` pins exact values to catch fixture
   corruption; A1's tamper test uses `new Uint8Array(ciphertext.slice())` (independent
   copy) and proves the baseline is unpolluted afterwards.
7. **No new runtime dependencies.** Everything uses browser Web Crypto. (The dapp phase
   will add `@steemit/steem-uri` — deferred, not part of A*.)
8. **Canonical base64url only (A1.1).** Every binary envelope field must satisfy
   `encodeBase64Url(decodeBase64Url(value)) === value`. The A1 behavior that
   accepted trailing-bit aliases (e.g. salt `…ODx` decoding to the same 16 bytes
   as the canonical `…ODw`) is CLOSED: exactly one encoding per byte sequence
   is valid, so downstream string comparisons of envelope fields are safe.
9. **Shared validation entry points (A1.1).** Alias, password, account-name and
   WIF rules live ONLY in `src/lib/vault/validation.ts` — never re-implement at
   a call site or only in the UI. Aliases: NFC display value stored, uniqueness
   key `NFC(name).toLowerCase()` (`vaultNameComparisonKey`), 1–64 code points
   measured on BOTH the raw input and its NFC form (NFC composition can expand,
   e.g. U+0344 → 2 code points), no trimming, no leading/trailing whitespace,
   no Cc/Cf/Cs (unpaired surrogates — reachable via `JSON.parse` of a backup)
   /Zl/Zp code points; legally paired astral characters pass. Password policy
   (≥14 code points, versioned common-password blocklist, not the normalized
   account name, not the same-flow master password) runs
   ONLY in create / independent-import / change-password — unlocking, export
   and deletion must keep accepting the existing password. Master-password
   comparison is "same flow, same input": never request it just to compare,
   never persist it; `validation.ts` stores nothing. WIF checks delegate to
   the real `steem.auth.isWif`/`getPublicKey` and normalize account names
   through the shared `normalizeSteemUsername` (never a bare `toLowerCase`).
10. **Resource boundaries are module constants, enforced in the validators
   (A1.1).** `envelope.ts` exports the single source of truth: raw envelope
   JSON ≤ 1 MiB (`parseVaultEnvelopeJson` checks before `JSON.parse`),
   decoded ciphertext ≤ 1 MiB (encoded-length pre-check before decode),
   decrypted payload UTF-8 ≤ 1 MiB − 16 (the GCM tag), ≤ 400 key entries,
   ≤ 100 distinct normalized accounts. Over-limit → `VAULT_LIMIT_EXCEEDED`
   (NOT `VAULT_ENVELOPE_INVALID`); structural violations keep their own codes.
   Create/import/validate paths all call the same validators — do not re-derive
   bounds at call sites.
11. **Session identity is `(vaultName, createdAt, revision, lockEpoch)` (A2).**
   Every session-bound operation re-reads the record and compares ALL FOUR —
   the `createdAt` binding is what stops remove + same-name-recreate from
   resetting counters to 0/0 and colliding with a live session (a stale tab
   would otherwise CAS-overwrite the recreated vault's ciphertext — permanent
   corruption, found in review). Known residual window: same-millisecond
   recreate still collides (`Date.now()` granularity); closing it fully needs a
   random per-record id, deferred to a future `VaultRecordV1` schema version.
12. **IndexedDB transaction discipline (A2).** Inside a `readwrite` transaction
   callback, only IDB request promises may be awaited — never a macrotask
   boundary (real IDB auto-commits and then throws `TransactionInactiveError`;
   the fake reproduces this). Uniqueness check + write happen in ONE
   transaction; if the callback throws, the transaction is aborted (no partial
   writes). The comparison key is scanned via `getAll` — it is never persisted
   into `VaultRecordV1` and never part of the AAD.
13. **Cross-tab invalidation is two-layered (A2).** The hard line is the
   per-operation freshness re-read (invariant 11); `BroadcastChannel`
   (`VAULT_DB_NAME`) is acceleration only and the code must keep working with
   it absent. `lock()` clears memory first (`kek.fill(0)` → drop references),
   then persists `lockEpoch + 1`, then broadcasts — and the broadcast now runs
   in a `finally`, so a failed persistence still notifies other tabs. `lock()`
   on a concurrently-removed vault propagates `VAULT_NOT_FOUND` (memory is
   already cleared) — callers must tolerate that code.
14. **The post-CAS adopt branch uses the LIVE closure session's KEK (A2)** —
   never the pre-await snapshot (a destroy + re-unlock interleave could
   otherwise install a zeroed KEK and corrupt the vault silently; found in
   review). Pure unlock/lock never touches salt/IV/ciphertext; every payload
   mutation mints a fresh IV and re-encrypts the whole payload with
   `revision + 1` via CAS. `mutatePayload(mutator)` hands the mutator a
   payload copy containing WIFs — mutators are for vault-internal feature code
   (A3/A4) ONLY; never pass component-level callbacks through.

## Error taxonomy (17 codes, types.ts order)

`VAULT_NAME_EXISTS` · `VAULT_NOT_FOUND` · `VAULT_EMPTY` · `VAULT_MODE_REQUIRED` ·
`VAULT_OPERATION_UNSUPPORTED` · `VAULT_LOCKED` · `VAULT_PASSWORD_INVALID` ·
`VAULT_ENVELOPE_INVALID` · `VAULT_PAYLOAD_INVALID` · `VAULT_SESSION_STALE` ·
`VAULT_STORAGE_UNAVAILABLE` · `VAULT_CRYPTO_UNAVAILABLE` ·
**`VAULT_NAME_INVALID`** (alias format/NFC/forbidden-category rules) ·
**`VAULT_PASSWORD_WEAK`** (strength policy, create/import/change-password only) ·
**`VAULT_KEY_INVALID`** (WIF, derived public key, account association) ·
**`VAULT_LIMIT_EXCEEDED`** (resource caps) · `VAULT_AUTHORITY_UNAVAILABLE`.
Bold = added in A1.1. Messages are English, machine-routed via `code` (UI text
goes through i18n) and never echo names, passwords, WIFs, ciphertext or payload.

## Pitfalls already hit

- **jsdom crypto is Node's webcrypto itself.** Unlike the `localStorage` case in
  `tests/setup.ts`, nothing shadows it — `globalThis.crypto === window.crypto` in
  vitest jsdom, `subtle` and `getRandomValues` just work. Do not add setup workarounds.
- **`globalThis.crypto` is a configurable getter.** To test the unavailability path,
  `Object.defineProperty` a replacement and restore the *original descriptor* in
  afterEach (the established pattern in `vault-crypto.test.ts`). Verified stable under
  shuffled and single-test runs.
- **PBKDF2 600k costs ~0.5–0.8s per derivation.** Share derived KEKs via `beforeAll`;
  give tests that derive their own KEK an explicit ~20s timeout. `vault-crypto.test.ts`
  derives exactly 4 times total (~3–5s for the file).
- **base64url MUST be canonical (closed in A1.1).** The A1 code accepted trailing-bit
  aliases — 16 alternative last characters for the salt (`…ODx` vs `…ODw`), 4 for the
  fixture ciphertext — decoding to identical bytes. A1.1 rejects them
  (`encodeBase64Url(decodeBase64Url(value)) === value`, else
  `VAULT_ENVELOPE_INVALID`), so envelope fields now have exactly one valid encoding
  and may be string-compared directly. Do not reintroduce multi-form idempotency.
- **Resource caps: two-stage size checks.** The ciphertext cap checks the ENCODED
  string length (≤ `VAULT_ENVELOPE_CIPHERTEXT_MAX_CHARS` = 1398102) BEFORE decoding,
  so an oversized field never allocates its decoded bytes; the decoded length is then
  re-checked. `parseVaultEnvelopeJson` and `validateVaultPayloadText` use the same
  trick: a cheap UTF-16-unit proxy (UTF-8 bytes are always ≥ code units) rejects
  obviously oversized text, then `TextEncoder` gives the exact byte count for
  multi-byte inputs that slip under the unit bound.
- **WIF verification is two-layer (A1.1 discipline).** Under vitest,
  `@steemit/steem-js` is aliased to `tests/mocks/steem-js.ts` (`isWif` → always
  true, `getPublicKey` → fake), and the real `isWif` cannot run in vitest jsdom
  anyway (`@noble/hashes` 2.x rejects the Node Buffers steem-js passes in — see
  AGENTS.md MAIN-60). Therefore: vitest tests only prove branches/error codes;
  REAL checksum/derivation/vector comparison evidence comes from
  `tests/node/vault-wif-real-check.mjs`, run with plain `node` (never registered
  in `pnpm test`). Rerun that script whenever WIF handling changes.
- **Unicode property escapes (`\p{Cc}` etc.) need an ES2018+ runtime** — same
  baseline as the Web Crypto API the vault depends on, so acceptable. Verified the
  repo's `tsc` (target ES2017) accepts the literals; keep the `u` flag on.
- **Duplicated byte constants.** salt/iv/tag sizes are defined on both envelope and
  crypto sides, locked together by consistency assertions in `vault-envelope.test.ts`.
  If you add a third consumer, prefer importing from `crypto.ts` over redefining.
- **jsdom has no IndexedDB but DOES have Node's BroadcastChannel (A2).** Registry
  tests therefore run against `tests/mocks/fake-indexeddb.ts` (hand-written, no new
  dependency); the "no broadcast" path is exercised by explicitly hiding the global.
  Fake fidelity bounds (documented in its header): no abort rollback (an
  `abortCount()` hook makes abort calls observable instead), no versionchange/
  blocked negotiation, FIFO transaction queue. Real-browser semantics were proven
  separately in review via Playwright + real Chromium/IndexedDB (43/43 incl. real
  rollback and cross-page BroadcastChannel) — rerun such golden checks when the
  transaction discipline itself changes, not for every edit.
- **Concurrent `unlock` calls overwrite, not merge (A2).** The second completion
  replaces the session; the replaced session's KEK is only GC'd, not `fill(0)`-ed.
  Single-tab UI never races unlocks — if A4/A5 ever allow concurrent unlock calls,
  clear the previous session explicitly first.
- **Vault tests must stay shuffle-stable (A2 standard).** `vault-service.test.ts`
  rebuilds fake + registry + service in `beforeEach` and shares only `beforeAll`
  KEKs — that is the pattern to copy for new lifecycle suites.

## Extension checklist

- **A2 has landed** — consume `registry.ts` / `service.ts` as-is; do not bypass them
  with direct IndexedDB access. Session identity, transaction discipline, cross-tab
  invalidation and the adopt-branch KEK rule are invariants 11–14 above. The manager
  (`VaultManager` orchestration incl. `activateVault`) is A4; work-mode UI is A5.
- **A3 has landed (`backup.ts`)** — consume `exportVaultBackup` /
  `importVaultBackup` / `mergeVaultBackup` as-is. Wiring rules for A4/A5:
  - Backups are the five envelope fields only; TEXT backups must be parsed through
    `parseVaultEnvelopeJson` first (the raw-JSON 1 MiB gate lives there) — the
    import functions take an already-parsed `VaultEnvelopeV1`.
  - Single-password contract: independent import uses one password both to decrypt
    the source and as the new vault's password, so it MUST pass
    `validateVaultPassword` (weak source passwords are rejected — guide users to
    re-encrypt via UI, do not weaken the check). Merge decrypts with the source
    password only; no policy runs on it.
  - Import is instance-bound: after `createVault`, the unlock adoption check and
    the failure rollback both verify the record is still the just-created instance
    (name + `createdAt`) before writing/deleting — a concurrent remove+recreate of
    the same name is never cross-deleted or cross-written (known residual: a
    sub-millisecond read→delete window inside the rollback, documented in code).
  - Merge requires the target unlocked on the SAME service instance, snapshots a
    `preMergeBackup` (memory-only, does not touch `lastBackupAt`), dedupes on
    `(accountName, role, publicKey)` with TARGET entries winning, and any failure
    leaves the target ciphertext byte-identical. An empty/no-change source still
    rewrites the record (fresh IV, revision+1) — deliberate, do not add an
    equality short-circuit.
  - **Post-merge lock is the Manager layer's job (blueprint contract; LANDED
    in A4).** The low-level `mergeVaultBackup` deliberately does NOT lock (the
    A3 tests pin `locked: false` at the primitive level), but the blueprint
    requires the target to be locked after a successful merge, with revision
    and lockEpoch advanced. `manager.importVaultDetailed` calls `service.lock()`
    right after a successful merge and its tests assert `locked: true` +
    `lockEpoch + 1`; a `lock()` failure still has cleared memory and propagates.
    The `preMergeBackup` flows out through `importVaultDetailed` — the UI (A5)
    must deliver it to the user (file save/download or an explicit discard)
    before claiming the pre-migration backup is done; the memory-only snapshot
    alone is not a completed backup.
  - `exportVaultBackup` CAS-writes `lastBackupAt` — the revision bump invalidates
    unlocked sessions for that vault in ANY tab (including the caller's own
    service instance). UI flows should lock first or tolerate re-unlock after
    export.
- **A4 has landed (manager / signer / facade)** — wiring rules for A5/A6:
  - Components get ONE entry point: the `SigningFacade` (compose via
    `createVaultManager(registry)` + `manager.createSigner()` + the legacy
    signer with a WIF getter from the login state). Never build a signer at a
    component, never query `/api/query/accounts` outside the vault signer.
  - The vault signer's authority pre-check is per-signing-request: one sorted
    batched `fetchAccounts(..., { fresh: true })` (bypasses browser L1 only —
    the server keeps its 10s/300s cache governance); `degraded`/missing
    accounts/malformed authority/fetch failure → `VAULT_AUTHORITY_UNAVAILABLE`
    with ZERO signing calls. The legacy signer deliberately has NO pre-check
    (A6 acceptance: default privateKey behavior unchanged).
  - `recover_account` is deliberately unsupported through the facade/signers
    (`VAULT_OPERATION_UNSUPPORTED`): it needs old+new owner dual signatures
    (2026-10-08 incident, `tx_missing_other_auth`); recovery flows keep the
    dedicated dual-key path in `client.ts` — do not route them into the vault
    signer until multi-key signing exists.
  - `changePassword` on an already-unlocked vault bumps lockEpoch by +2 (unlock
    switch-clears +1, final lock +1) and a WRONG old password locks the
    previously-unlocked session (retry needs a fresh unlock) — A5 UX should
    account for both. `importVault` (the A0-shaped method) drops the
    `preMergeBackup`; merge flows must use `importVaultDetailed`.
  - Known residual (documented in code): the same-millisecond remove+recreate
    `createdAt` collision (A2 invariant 11) and the sub-ms rollback window in
    A3 import; both need a future schema-level record id to fully close.
- **A5 has landed (work-mode UI)** — wiring rules for A6/B:
  - The composition root lives in `src/components/vault/vault-manager.tsx`:
    `getVaultRuntime()` is a MODULE-LEVEL SINGLETON (registry + manager +
    facade with `manager.createSigner()` as the vault backend). The manager's
    session service is pure memory, so a second runtime could never share the
    session the drawer unlocks — consume `useVaultRuntime()` /
    `<VaultProvider>` (mounted once in app-layout), never build another
    runtime. The privateKey backend is NOT wired yet (A6 injects the
    login-state WIF getter); until then facade privateKey signing fails with
    a TypeError — nothing routes signing through the facade before A6.
  - Mode is a DEVICE PREFERENCE (settings row): the switcher works
    signed-out. `useSigningMode` updates local state in place on success and
    rethrows on failure with the previous mode still displayed — do not add a
    page refresh to mode switching.
  - A5 UI surfaces ALL VaultErrors through `vault.errors.<CODE>` i18n keys
    (17 codes + `unexpected`, four locales, pinned by
    `tests/unit/vault-i18n-errors.test.ts`). Never render `error.message`.
  - The merge completion dialog enforces the preMergeBackup delivery
    contract: "Continue" (and any close) is blocked until the user downloads
    the snapshot or explicitly discards it, and the post-merge LOCKED state
    is shown with re-unlock guidance.
  - The B-phase dapp hook is reserved: dispatching
    `VAULT_WORK_MODE_OPEN_EVENT` (exported from app-layout.tsx) opens the
    drawer and focuses the mode switcher (`#work-mode-switcher`).
  - jsdom notes for tests: radix DropdownMenu opens via keyboard
    (ArrowDown), not click; `File#text()` does not exist in jsdom (the UI
    uses a FileReader helper); modal dialogs aria-hide the rest of the page,
    so Playwright role queries must target the dialog itself or use CSS
    locators.
- **New vault tests**: follow the fixture-recompute discipline; never copy WIFs or
  passwords into `src/`. Anything touching WIF handling needs BOTH layers: mock-driven
  vitest cases plus a rerun of `tests/node/vault-wif-real-check.mjs` recorded in the
  PR body.
