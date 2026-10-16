# 02 — Authentication & key handling

## Flow (end to end)

```
GET  /api/auth/challenge  { username }
      → SteemService.generateChallenge (random)
      → Redis SET auth:challenge:{username} EX 300 NX     (one-time-ish, no overwrite)
      → { challenge }  (Cache-Control: no-store)
client: derive WIF for username+role from password, or use stored posting key
      → SteemSigner.signChallenge(challenge, privateKey)   (client-side ECDSA)
POST /api/auth/login       { username, signedChallenge, publicKey }
      → Redis GET challenge → 401 if absent
      → SteemService.verifyChallengeSignature (ECDSA verify against submitted publicKey)
      → Redis GETDEL challenge (atomic one-time consume; null → 401)
      → getAccounts(username) → key must be one of posting/active/owner authority keys
      → { account } — NO server session is created
```

There is **no server-side session** (`SESSION_SECRET` is declared in `.env.example` but unused).
Auth state is client-side only: Redux `auth` slice + optional localStorage.

## Files

- `src/app/api/auth/{challenge,login,logout}/route.ts` — the three endpoints
- `src/lib/steem/server.ts` — `generateChallenge`, `verifyChallengeSignature`, `getKeyType`
- `src/components/auth/login-form.tsx` — **the only live login UI** (login page, header modal,
  re-auth modal). Contains: username normalization, required-authority gate (#338), posting-key
  restore from localStorage, remember-me writes.
- `src/hooks/use-auth.ts` — read-only consumption (`username`/`isAuthenticated`/`logout`).
  ⚠️ Its `login`, `useRequireAuth`, `usePrivateKey` are dead, behavior-rotted code (no
  normalization, no #338 gate). Do not call them; candidate for deletion.
- `src/lib/auth/browser-storage.ts` — localStorage contract (see below).
- `src/lib/store/slices/auth.ts` — holds credentials incl. private keys; sanitized in DevTools.

## Invariants

1. **Both auth routes fail closed when Redis is unavailable** (both return 503:
   login rejects before verifying; challenge rejects before issuing — it never
   hands out a challenge that could not be stored and later verified). Never
   "degrade" login to signature-only acceptance.
2. **Challenges are stored `NX`** — simultaneous requests share one challenge (a deliberate F6/S2
   hardening; do not reintroduce overwrite semantics). Consumed atomically via
   `redis.getdel` AFTER signature verification: a failed signature does not
   burn the challenge (client may retry), and concurrent replays of a valid
   signature are decided atomically — exactly one wins, the rest get 401.
   GETDEL needs Redis ≥ 6.2 (deployment baseline is ElastiCache Redis 7+).
3. **Verify-then-attribute order**: ECDSA verify against the *submitted* public key first, then
   check that key belongs to the account's authorities. Never skip the second step.
4. Challenge TTL is 300s; username must match `/^[a-z0-9.-]{2,}$/` (server side) — so **clients
   must normalize** (lowercase, strip `@`) before calling. `LoginForm` does;
   dead `use-auth.login` does not. Challenge responses carry
   `Cache-Control: no-store` and the client `getChallenge` fetch uses
   `cache: 'no-store'`.
5. Rate limits: challenge = IP-dimension + username-dimension (username over-limit returns the
   existing challenge rather than 429, to avoid targeted login-DoS); login and
   logout each have a 10/min/IP limit.

## Known functional limitations (recorded in AGENTS.md "待解决问题")

- Public-key matching (client and server) only inspects `key_auths[0][0]` of each authority —
  multi-key authorities cannot log in. If you fix this, fix both sides.
- `memo_key` can pass login but yields an empty-permission session (server `validKeys` includes
  it). Unresolved product decision — do not silently extend this pattern to new code.

## Steem authority semantics — signing capability is hierarchical (2026-10-16)

Verified against Steem core v0.23.0
(`libraries/protocol/include/steem/protocol/transaction_util.hpp`, `sign_state.cpp`) and live
mainnet blocks. This is consensus truth, not wallet policy — build key-selection logic on it.

- Consensus `verify_authority` falls back **downward**: a posting-class op
  (`claim_reward_balance`, `vote`, `custom_json`, …) is satisfied by the account's
  **posting, active, OR owner** authority; an active-class op (`transfer`,
  `delegate_vesting_shares`, …) by **active or owner**; only owner-class ops
  (`account_update` carrying owner, `recover_account`) are owner-only. A higher key can always
  stand in for a lower authority; the reverse cannot.
- **`database_api.get_required_signatures` is NOT an acceptance oracle.** It computes a strict
  per-class minimal set (the posting branch checks only the posting authority — see
  `signed_transaction::get_required_signatures` in `libraries/protocol/transaction.cpp`) and
  does not model the fallback above. An active key returning `[]` there does **not** mean the
  chain rejects an active-signed posting op. (This exact misreading drove #375's original
  design; corrected in #378. On-chain proof that an active-signed claim is accepted: trx
  `bd7ee5cf649fc33207b13e797b20d759f6cfbaf7`, block 110487842.)
- **Extra signatures are rejected** (`tx_irrelevant_sig`): the signature set must satisfy the
  authority and nothing more — never "shotgun-sign" with several keys to be safe.
- `account_auths` recursion checks the referenced account's **active** authority
  (`sign_state.cpp`); multi-account authority graphs resolve through it.
- `memo_key` satisfies no operation authority anywhere — a memo-key-only session can sign
  nothing.

### Wallet conventions on top of the chain rules

- **Signing capability ≠ key possession.** Reveal/display flows (`account-key-row`) need the
  actual WIF of that role: an active-key login can *sign* a posting op but cannot *reveal* the
  posting key. Do not apply the signing hierarchy to display logic — that is the one place
  where "hierarchy" does not transfer.
- Least privilege when the client picks a key: prefer the lowest authority the chain accepts
  for that op. The claim banner (#378) resolves
  session posting → device-remembered posting (chain-verified) → session active → session owner
  → re-auth dialog. Re-auth dialog copy keeps asking for the minimal key (posting key /
  password) as a habit, while accepting higher keys, which the chain honors.
- `LoginForm.requiredAuthTypes` (#338) models exactly the chain signing hierarchy:
  `covers('posting') = posting || active || owner`, `covers('active') = active || owner`,
  `covers('owner') = owner`. `['posting']` therefore rejects only memo-key logins. Do not
  "tighten" it to posting-only — that rejects sessions the chain itself accepts (#377 was
  closed unmerged for exactly this reason).

## CSRF (double-submit)

- Token: `base64url(timestamp).base64url(HMAC-SHA256(CSRF_SECRET, timestamp))`, 24h max age,
  constant-time MAC comparison (`csrf.ts`). `verifyCSRF()` skips GET/HEAD/OPTIONS.
- The cookie is minted **in `proxy.ts` on every document response** (edge runtime, Web Crypto —
  byte-identical to the Node generator; parity is unit-tested in
  `tests/unit/proxy-csrf-cookie.test.ts`). This is what lets anonymous visitors POST analytics.
- Cookie attributes must stay in sync between `proxy.ts:188-197` and `csrf.ts:setCSRFToken`:
  `httpOnly:false, secure(prod), sameSite:'strict', maxAge 86400, path '/'`.
- Client mirrors the cookie into `X-CSRF-Token` on every mutating `apiClient` call
  (`client.ts` request helper reads `document.cookie`).
- **Production without `CSRF_SECRET` = every mutation rejected** (fail-closed, both runtimes).

**Pitfall:** if you add a new POST endpoint, `verifyCSRF` must be the first thing after method
dispatch, before `request.json()` — malformed-JSON handling after CSRF avoids turning attacker
garbage into 5xx. Parse the body inside its own try/catch and return 400 on failure (the login
route does this; copy that pattern, do not let a parse throw reach the outer catch).

## Private keys on the client

- Signing happens exclusively in `SteemSigner` (`client.ts`) via `steem.auth.sign`/`signTransaction`.
  Key material never enters request bodies, Redux actions other than `auth/setCredentials`, or
  console output.
- Redux DevTools sanitizers (`store/index.ts`) cover `auth/setCredentials` — **the only action
  allowed to carry key material**. If you invent a second action that carries keys, you must
  extend `devActionSanitizer` (there is no guard that reminds you).
- localStorage (`browser-storage.ts`): **only** `username` + optional posting key
  (`REMEMBERED_*` keys). Never active/owner keys. Note the module only has get/clear — the actual
  `setItem` is inlined in `login-form.tsx:308-326`; keep new writes inside that same audit surface
  or extend the module properly.
- Logout (`useAuth().logout`): fires `/api/auth/logout` (CSRF'd no-op on the server) and
  unconditionally clears Redux + both localStorage keys regardless of the HTTP result.
- Re-auth (#338): `LoginForm` accepts `requiredAuthTypes` and enforces the authority hierarchy
  owner > active > posting (memo separate) — which mirrors the chain's signing fallback, see
  the "Steem authority semantics" section above. Modal consumers (change password, recovery,
  claim re-auth) must pass the levels they actually need; missing authority fails loudly with
  `insufficientAuthority`.

## Testing notes

- All three auth routes have unit coverage:
  `tests/unit/auth-challenge-route.test.ts` (limits, NX, degradation),
  `tests/unit/auth-login-route.test.ts` (Redis-null → 503, atomic GETDEL
  one-time consumption incl. concurrent replay, `validKeys` matching,
  malformed JSON → 400), `tests/unit/auth-logout-route.test.ts` (no-op shape,
  CSRF, rate limit).
- Client tests mock `apiClient.login`; server tests mock `@/lib/db`-style singletons
  (see 08-testing.md).
