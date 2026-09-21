# 03 — Broadcast relay routes (`/api/broadcast/*`)

## What a relay route is

A thin POST endpoint that takes an already-signed transaction from the client and forwards it to
the chain. 19 routes exist. The canonical body is:

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
   (see `tests/unit/proposals-broadcast-routes.test.ts` for the pattern). 14 of 19 routes currently
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

## Cache invalidation after broadcast — ⚠️ mostly dead, know the state

The design intent: after a successful broadcast, delete the user's now-stale Redis caches and tell
the browser L1 to drop entries. **Current reality (review 2026-09-21):**

- `cacheDeleteByPrefix('cache:query:accounts' | '...:market' | '...:proposals')` — these three
  **work** (verbatim prefixes), but are global (any broadcast flushes the whole site's accounts
  cache).
- `cacheDeleteByPrefix(\`cache:query:<x>:${username}\`)` — **permanent no-op**: query keys are
  sha256-hashed (`hashedCacheKey`), so a plaintext username prefix can never match. Affects the
  `wallet-estimate-extras` / `withdraw-routes` / `vesting-delegations` deletes in every route.
  When fixing: delete by the *hashed* key (`hashedCacheKey('cache:query:wallet-estimate-extras', username)`
  is already the full prefix to scan), and sanitize the username (a `*`/`?` in it lands directly
  in the SCAN MATCH pattern).
- `X-Cache-Invalidate: <username>` response header — **dead channel**: only `cachedFetch` (GET
  queries) reads it, broadcast POSTs go through plain `fetch` whose headers are discarded, and the
  client cache keys are URLs so a username prefix would never match anyway. Do not rely on it;
  if you build post-action refresh, invalidate explicit URLs like
  `savings-withdraw-history.tsx:88` does.
- Known per-route drift (the consequence of copy-paste without tests): `witness-vote`/`witness-proxy`
  don't invalidate `cache:query:witnesses` (600s TTL!); `recover-account` doesn't invalidate
  `cache:query:accounts` at all; `proposal-create/remove` require `username` and never use it.
  When you add a route, list *which* caches your op actually dirties and invalidate exactly those.

## Route inventory & status (2026-09-21)

Working & consumed: transfer, convert, delegate, power-down, custom-json, limit-order-create,
limit-order-cancel, proposal-vote, proposal-create, proposal-remove, witness-vote, witness-proxy,
account-update, change-recovery-account, cancel-transfer-from-savings,
set-withdraw-vesting-route, recover-account (see 05 for its CAS bug).

- `vote` — **dead route** (no callers; wallet does not do content voting). Candidate for removal.
- `account-create` — exists, no frontend consumer found in review; verify before relying on it.
- Power-up (`transfer_to_vesting`) intentionally reuses the `transfer` endpoint — correct under
  relay philosophy; only rate-limit bucketing treats it as "transfer".

## Client-side prerequisites for signing

`SteemSigner.signTransaction` fetches `ref_block_num/prefix` + sets `expiration` via
`/api/query/transaction-header` (cached — see 04 for the freshness discussion), then signs with
`@steemit/steem-js` locally. Account names are normalized (`normalizeSteemUsername`) inside the
signer; operation construction is the caller's job.
