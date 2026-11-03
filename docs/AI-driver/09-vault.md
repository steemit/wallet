# 09 — Vault (encrypted multi-account wallet)

> Status date: 2026-11-04, baseline `next@fe3276b8` + A1.1 (PR #382 A0, PR #383 A1,
> A1.1 shared validation / canonical base64url / resource limits).
> Covers only what has landed: type contracts, error taxonomy, envelope validation,
> Web Crypto whole-envelope encryption and the A1.1 shared input validation with
> resource boundaries. Registry/service/backup/manager (A2–A6) are not
> implemented yet — this doc grows with each task package. Tracking issue: #381.

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
tests/fixtures/vault-development-test-vectors.json   fixed test vectors (byte-identical
                           copy of the reviewed source; TEST-ONLY keys/passwords)
tests/unit/vault-contract.test.ts    fixture parseability + exact value pins
tests/unit/vault-envelope.test.ts    rejection matrix + canonical/resource cases (A1+A1.1)
tests/unit/vault-crypto.test.ts      vectors recomputed for real (16 cases)
tests/unit/vault-validation.test.ts  alias/password/account tables + MOCK-driven WIF
                           branches (A1.1 — mock proves branches only, NOT real checks)
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
   key `NFC(name).toLowerCase()` (`vaultNameComparisonKey`), 1–64 code points,
   no trimming, no leading/trailing whitespace, no Cc/Cf/Zl/Zp code points.
   Password policy (≥14 code points, versioned common-password blocklist,
   not the normalized account name, not the same-flow master password) runs
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

## Extension checklist

- **A2 (registry/service)**: consume `crypto.ts` primitives as-is; KEK + payload live
  only in the service closure; on lock, `fill(0)` the KEK bytes best-effort and drop
  references (strings/CryptoKey cannot be zeroed — document that honestly). Unlock→
  no mutation → salt/iv/ciphertext unchanged; any payload mutation → fresh IV +
  re-encrypt (`vault-crypto.test.ts` case 10 encodes this contract). Alias handling
  MUST reuse `validateVaultName` + `vaultNameComparisonKey` from `validation.ts`
  (uniqueness = comparing keys inside the same IndexedDB `readwrite` transaction);
  never re-implement the name rules or compare raw strings.
- **A3 (backup/import)**: backups are the five envelope fields only (revision/
  lockEpoch/timestamps are local runtime state). Independent import MUST mint a new
  salt+iv and parse incoming text through `parseVaultEnvelopeJson` — the raw-JSON,
  ciphertext and payload caps are then enforced by the shared validators before any
  write; never duplicate the bounds at the call site. Password policy applies to the
  NEW password chosen during independent import / change-password only.
- **New vault tests**: follow the fixture-recompute discipline; never copy WIFs or
  passwords into `src/`. Anything touching WIF handling needs BOTH layers: mock-driven
  vitest cases plus a rerun of `tests/node/vault-wif-real-check.mjs` recorded in the
  PR body.
