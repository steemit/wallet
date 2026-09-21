# 02 — Authentication & key handling

## Flow (end to end)

```
GET  /api/auth/challenge  { username }
      → SteemService.generateChallenge (random)
      → Redis SET auth:challenge:{username} EX 300 NX     (one-time-ish, no overwrite)
      → { challenge }
client: derive WIF for username+role from password, or use stored posting key
      → SteemSigner.signChallenge(challenge, privateKey)   (client-side ECDSA)
POST /api/auth/login       { username, challenge, signedChallenge, publicKey }
      → Redis GET challenge → 404 if absent
      → SteemService.verifyChallengeSignature (ECDSA verify against submitted publicKey)
      → getAccounts(username) → key must be one of posting/active/owner authority keys
      → Redis DEL challenge (one-time consumption)
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

1. **Login fails closed when Redis is unavailable** (`login/route.ts` returns 503). Never "degrade"
   to signature-only acceptance.
2. **Challenges are stored `NX`** — simultaneous requests share one challenge (a deliberate F6/S2
   hardening; do not reintroduce overwrite semantics). Consumed via `redis.del` after successful
   verify. (Known nit: get→verify→del is not atomic; docs call it "prevents replay" — if you touch
   this, switch to `GETDEL`.)
3. **Verify-then-attribute order**: ECDSA verify against the *submitted* public key first, then
   check that key belongs to the account's authorities. Never skip the second step.
4. Challenge TTL is 300s; username must match `/^[a-z0-9.-]{2,}$/` (server side) — so **clients
   must normalize** (lowercase, strip `@`) before calling. `LoginForm` does;
   dead `use-auth.login` does not.
5. Rate limits: challenge = IP-dimension + username-dimension (username over-limit returns the
   existing challenge rather than 429, to avoid targeted login-DoS); login and challenge have
   limits; logout has none (known asymmetry).

## Known functional limitations (recorded in AGENTS.md "待解决问题")

- Public-key matching (client and server) only inspects `key_auths[0][0]` of each authority —
  multi-key authorities cannot log in. If you fix this, fix both sides.
- `memo_key` can pass login but yields an empty-permission session (server `validKeys` includes
  it). Unresolved product decision — do not silently extend this pattern to new code.

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
garbage into 5xx (login route currently violates this and returns 500 on bad JSON; don't copy it).

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
  owner > active > posting (memo separate). Modal consumers (change password, recovery) must pass
  the levels they actually need; missing authority fails loudly with `insufficientAuthority`.

## Testing notes

- Challenge route has 20+ unit tests (limits, NX, degradation). **Login and logout routes have
  zero** — when you touch them, add coverage for: Redis-null → 503, challenge one-time `del`,
  `validKeys` matching, malformed JSON → 400.
- Client tests mock `apiClient.login`; server tests mock `@/lib/db`-style singletons
  (see 08-testing.md).
