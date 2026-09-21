# 03 — Broadcast relay routes (`/api/broadcast/*`)

## What a relay route is

A thin POST endpoint that takes an already-signed transaction from the client and forwards it to
the chain. 18 routes exist. The canonical body is:

```json
{ "signedTx": <SignedTransaction>, "username": "<account>" }
```

The **only** server-side responsibilities, in order:

```
verifyCSRF(request)            // 403 on failure — always first
rateLimit(request, 'broadcast', { maxRequests: 10, windowSeconds: 60 })
shape validation               // reject obvious garbage: field types, op count, required fields
SteemService.broadcastTransaction(signedTx)
cache invalidation (see ⚠️ below)
NextResponse.json({ success: true, result })
```

Exceptions: `recover-account` uses `maxRequests: 3` and additionally validates recovery shape/
DB gating (see 05-recovery.md) — it is a recovery-business route, not a pure relay.

## Adding a new broadcast route — checklist

1. Create `src/app/api/broadcast/<name>/route.ts` following the template above. Copy the *simplest*
   existing route (`transfer/route.ts`), not the most elaborate one.
2. Client side: add a `SteemSigner.sign<Op>` method (construct op, `signTransaction`) and an
   `apiClient.broadcast<Op>` wrapper in `client.ts` — read the POST response's `success` and
   surface errors to the user (catch + `setError` or toast; **never** leave a fire-and-forget
   promise — the market page is the existing counter-example).
3. **Register the route in `STATIC_API_ROUTES`** (`rate-limit.ts`) — F14 made route scoping
   default-deny; an unregistered route falls into the catch-all scope and a CI guard on the route
   tree will fail. Run the route-tree test.
4. Normalize `username` from the body (`toLowerCase()`, strip `@`) before using it for logging or
   cache-key construction — the relay does not sanitize it for you (and see the SCAN caveat below).
5. Do **not** add: op-type allowlists, authority checks, signature verification, custom_json id
   or payload checks, tx size caps. If you believe you need one, read
   `docs/RELAY_ROLLBACK_IMPACT.md` and 01-architecture.md first.
6. Tests: a route-level test that mocks `SteemService.broadcastTransaction` + CSRF/limits
   (see `tests/unit/proposals-broadcast-routes.test.ts` for the pattern). 12 of 18 routes currently
   have none — that is how copy-paste drift happened; do not add to the backlog.

## Response & error conventions (current state; align when touching)

- Success: `{ success: true, result: <BroadcastResult> }`.
- Failure: `{ success: false, error: string, details?: string }` — `details` is only produced by
  `account-update`; the `details?` field declared on other client methods is decorative.
- Upstream/chain errors propagate as 500 with a generic message. Error strings must stay
  non-revealing (no stack, no upstream internals) — the chain's rejection message is echoed via
  `BroadcastResult` only.
- Server-side failure logs exist but have **no unified format** (`'Broadcast transfer error:'` vs
  `'Broadcast proposal create error:'` — mixed case/underscores). If you add logging, pick
  `Broadcast <route> error:` and consider unifying neighbors opportunistically.
- Success path has no op-level audit log (relies on OTel spans / ELB). Do not assume you can grep
  who broadcast what.

## Cache invalidation after broadcast — the contract

After a successful relay, delete exactly the Redis caches your op dirties (see
`docs/CACHING_AND_DEGRADATION.md` §2.7 for the per-route table):

- **Global data** (accounts / market / proposals / witnesses): plain prefix —
  `cacheDeleteByPrefix('cache:query:accounts')` etc.
- **User-scoped caches** (wallet-estimate-extras / withdraw-routes / the two
  delegation endpoints): the username MUST go through
  `hashedUserCachePrefix(prefix, username)` from `lib/cache/cache-key.ts`:

  ```ts
  await cacheDeleteByPrefix(
    hashedUserCachePrefix('cache:query:wallet-estimate-extras', username)
  );
  ```

  Query routes store keys with the username SHA-256-hashed (`hashedCacheKey`);
  interpolating the raw name produces a SCAN pattern that can never match.
  That exact mismatch shipped once and made every targeted delete a silent
  no-op — `tests/unit/cache-key.test.ts` pins the invalidation prefix to the
  real key construction, so keep those tests passing. The helper also
  normalizes the name (trim / strip `@` / lowercase) identically to the query
  routes, and its hex-only output cannot smuggle Redis glob metacharacters
  into the SCAN pattern.

- Only delete what the op changes. The historical copy-paste drift: witness
  votes invalidating withdraw-routes, proposal votes invalidating wallet
  extras, `recover-account` invalidating nothing (it replaces owner
  authority — it must flush accounts). When in doubt, enumerate what the op
  changes on chain and map it to the caches that serve it.

**Browser L1 invalidation is client-side and explicit** — there is no
`X-Cache-Invalidate` header anymore (the channel had no working consumer and
was removed in 2026-09). The wallet page's broadcast success path calls
`invalidateWalletCache(username)` (`lib/cache/client-invalidate.ts`) and then
bumps the refresh nonce. If you add a NEW broadcast success handler in a
component, call `invalidateWalletCache` for the acting user before triggering
any refetch — `cachedFetch` otherwise serves its fresh window with no request
and the UI keeps pre-broadcast data (see 06-frontend.md).

## Route inventory & status (2026-09-22)

Working & consumed: transfer, convert, delegate, power-down, custom-json, limit-order-create,
limit-order-cancel, proposal-vote, proposal-create, proposal-remove, witness-vote, witness-proxy,
account-update, change-recovery-account, cancel-transfer-from-savings,
set-withdraw-vesting-route, recover-account (see 05 for its CAS bug).

- `vote` — removed (2026-09-22): dead route with no callers; the wallet does not do content voting.
- `account-create` — exists, no frontend consumer found in review; verify before relying on it.
- Power-up (`transfer_to_vesting`) intentionally reuses the `transfer` endpoint — correct under
  relay philosophy; only rate-limit bucketing treats it as "transfer".

## Client-side prerequisites for signing

`SteemSigner.signTransaction` fetches `ref_block_num/prefix` + sets `expiration` via
`/api/query/transaction-header` (cached — see 04 for the freshness discussion), then signs with
`@steemit/steem-js` locally. Account names are normalized (`normalizeSteemUsername`) inside the
signer; operation construction is the caller's job.
