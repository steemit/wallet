# 09 — Vault (encrypted multi-account wallet)

> Status date: 2026-11-01, baseline `next@1e40a1a2` (PR #382 A0 + PR #383 A1).
> Covers only what has landed: type contracts, error taxonomy, envelope validation and
> Web Crypto whole-envelope encryption. Registry/service/backup/manager (A2–A6) are not
> implemented yet — this doc grows with each task package. Tracking issue: #381.

## Module map

```
src/lib/vault/types.ts     Type contracts only — zero runtime code (A0, PR #382)
src/lib/vault/errors.ts    VaultError (code + English message); codes come from types.ts
src/lib/vault/envelope.ts  base64url codec + five-field VaultEnvelopeV1 validation
                           + decrypted payload shape validation (A1, PR #383)
src/lib/vault/crypto.ts    PBKDF2 KEK derivation + AES-GCM whole-envelope encrypt/decrypt
                           + CSPRNG salt/iv generators (A1, PR #383)
tests/fixtures/vault-development-test-vectors.json   fixed test vectors (byte-identical
                           copy of the reviewed source; TEST-ONLY keys/passwords)
tests/unit/vault-contract.test.ts    fixture parseability + exact value pins
tests/unit/vault-envelope.test.ts    rejection matrix (75 cases)
tests/unit/vault-crypto.test.ts      vectors recomputed for real (16 cases)
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
   non-base64url characters, salt ≠ 16B, iv ≠ 12B, ciphertext outside 16B..1MiB →
   `VAULT_ENVELOPE_INVALID`. Bad payload shape → `VAULT_PAYLOAD_INVALID`. GCM
   authentication failure (wrong password / tampered / wrong AAD — indistinguishable
   by design) → `VAULT_PASSWORD_INVALID`. `crypto.subtle` missing →
   `VAULT_CRYPTO_UNAVAILABLE`, guarded per entry point (derive/encrypt/decrypt and
   separately getRandomValues) *before* any await.
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
- **base64url is not canonical.** Trailing-bit aliases (e.g. 16 alternative last
  characters for the salt) decode to identical bytes and pass validation. Before any
  A2/A3 code string-compares envelopes (dedup, idempotency), decide: reject non-zero
  trailing bits at decode, or compare re-encoded canonical forms.
- **`1 MiB ciphertext cap` semantics.** `VAULT_ENVELOPE_CIPHERTEXT_MAX_BYTES` bounds
  what a *valid* envelope may carry (keeps oversized input out of decryption); the
  decode allocation itself happens before the length check — bounding the raw string is
  the caller's (frame/body limit) job. Payload keys-count/size limits are the A3 import
  path's responsibility, noted at the call site.
- **Duplicated byte constants.** salt/iv/tag sizes are defined on both envelope and
  crypto sides, locked together by consistency assertions in `vault-envelope.test.ts`.
  If you add a third consumer, prefer importing from `crypto.ts` over redefining.

## Extension checklist

- **A2 (registry/service)**: consume `crypto.ts` primitives as-is; KEK + payload live
  only in the service closure; on lock, `fill(0)` the KEK bytes best-effort and drop
  references (strings/CryptoKey cannot be zeroed — document that honestly). Unlock→
  no mutation → salt/iv/ciphertext unchanged; any payload mutation → fresh IV +
  re-encrypt (`vault-crypto.test.ts` case 10 encodes this contract).
- **A3 (backup/import)**: backups are the five envelope fields only (revision/
  lockEpoch/timestamps are local runtime state). Independent import MUST mint a new
  salt+iv. Enforce payload size/keys-count limits here.
- **New vault tests**: follow the fixture-recompute discipline; never copy WIFs or
  passwords into `src/`.
