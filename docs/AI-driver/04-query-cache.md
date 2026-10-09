# 04 — Query API, caching & rate limiting

## Query route anatomy

All 17 `/api/query/*` routes follow:

```
GET with searchParams
rateLimit(request, 'query', { maxRequests: N, windowSeconds: 60 })   // N: 30–120 by route
param validation (bounds! clamp limit/page, validate formats)
withCache(cacheKey, ttlSeconds, staleTtlSeconds, fetcher)            // SteemService call(s)
NextResponse.json({ success: true, ...result.data,
                    ...(result.degraded && { degraded: true, staleAge }) })
Cache-Control + X-Degraded headers
```

`withCache` (`lib/cache/server-cache.ts`) is the stale-while-error wrapper:
fresh Redis hit → return; fetcher success → cache+return; fetcher failure → stale with
`degraded:true`; no stale → throw (caller → 503). When Redis is absent it just runs the fetcher
(read-only degradation is acceptable here, unlike login/recovery).

## Cache keys — `hashedCacheKey` and the no-passthrough rule

`lib/cache/cache-key.ts` hashes **every** user-supplied component with full SHA-256:

```ts
hashedCacheKey('cache:query:wallet-estimate-extras', username, includeOpenOrders)
// → 'cache:query:wallet-estimate-extras:<sha256(user)>:<sha256(bool)>'
```

The full-digest rule is deliberate (F7): a "safe-looking short strings pass through" branch once
allowed `sha256(victim).slice(0,16)` to collide with a victim's key (cross-account cache
poisoning). **Never add a passthrough branch**, and never interpolate raw user input into a key.
The Redis layer additionally prefixes everything with `REDIS_KEY_PREFIX` (default `wallet`) —
that prefix is why deletion helpers take the *unprefixed* key.

Key construction is unified (2026-09): every route with key components goes through
`hashedCacheKey` — `accounts` previously used a 32-hex truncated digest and `witnesses` /
`proposals/votes` interpolated trusted integers verbatim. Old-format entries are
unreachable but harmless (they expire by TTL; no migration). Static single-value keys
(`global-props`, `wallet-prices`, `median-history-price`) have no components to hash and
stay literal.

## Post-write invalidation

Broadcast routes delete the caches their operation dirties, using
`hashedUserCachePrefix` for user-scoped keys — see 03-broadcast.md and
`docs/CACHING_AND_DEGRADATION.md` §2.7 for the full contract and per-route
table. When adding a user-scoped query cache: build the key with
`hashedCacheKey(prefix, normalizedUsername, ...)` and normalize the username
with `normalizeAccountForCache` (trim / strip `@` / lowercase) so the
broadcast-side delete prefix matches.

## Rate limiting

- `rateLimit(request, action, { maxRequests, windowSeconds })`; key =
  `ratelimit:{ip}:{action}:{routeScope}:{windowStart}` in Redis (shared across instances), with an
  in-memory fallback per instance. `routeScopeOf()` derives the scope from the path with a
  **default-deny** policy (F14) — every route must be registered in `STATIC_API_ROUTES` or matched
  by the dynamic-collapse rules, and a CI test walks the real route tree.
- Quotas: broadcast 10/min (recover-account 3/min), query 30–120/min by route, auth
  challenge dual-dimension, recovery 3–5/min. **Only `auth/challenge` reads env overrides**
  (`RATE_LIMIT_AUTH_CHALLENGE_MAX/_WINDOW`); all other routes hardcode. Ignore the
  `RATE_LIMIT_MAX_*` names in docker-compose — nothing reads them.
- Client IP: `getClientIP()` honors `TRUST_PROXY_COUNT` (rightmost-N of `X-Forwarded-For`) →
  `x-real-ip` → `'unknown'`. **Never** read `x-forwarded-for` directly anywhere else (S6).
  Unset trust count in production logs a warning and collapses everyone into one bucket.
- Redis instance exists but commands error (maxclients/OOM/READONLY): `redisRateLimit` returns a
  `command-error` outcome and the caller runs the memory fallback — or rejects with 503 when
  `RATE_LIMIT_ALLOW_MEMORY_FALLBACK=false`. Never treat a failed command as "Redis healthy and
  did not block" (that bypass shipped once; fixed 2026-09). Plain disconnects are caught earlier
  by the singleton's 'close' handler nulling the instance.

## Response protocol — follow the majority shape

- Body: `{ success: true, <data>, degraded?: true, staleAge?: number }`.
- Headers: `Cache-Control` always; `X-Degraded: true` when degraded.
- Error: upstream-down with no stale → **503** with `{ error, degraded: true }` — the
  unified contract for every query route (2026-09; four routes previously returned 500
  and two more shadowed their inner 503 behind an outer 500).
- `Cache-Control` choice: `public, s-maxage=<ttl>, stale-while-revalidate=<staleTtl>` for global
  data; `private, max-age=<ttl>` when the body contains user-specific rows. User-scoped routes
  (wallet-estimate-extras, withdraw-routes, vesting-delegations*, owner-history, and market /
  proposals when a username param is present) are `private` — a shared/CDN cache must never
  store one user's rows under a `public` directive. market is public only for anonymous
  (no-username) requests.
- Username params: normalize once at the top (`trim().replace(/^@/,'').toLowerCase()`). Routes
  currently disagree (market lowercases, withdraw-routes doesn't, history doesn't at all) →
  same account = multiple cache keys. Be the normalized one.

## Per-route notes

- **accounts**: max 100 names per request (upstream constraint); balances/authority source of
  truth. Multiple frontend callers with different cache params (see 06) — prefer adding a shared
  hook over a 7th fetch site.
- **global-props**: 3s TTL (block-time-sensitive).
- **market**: fans out 4 upstream RPCs per miss (orderbook+ticker+trades+openOrders). `since`
  is validated (ISO-8601; garbage → 400) and quantized to a 30s bucket for the cache KEY only —
  keying the raw per-tick cursor minted a unique key per poll (cache never engaged for logged-in
  traffic). The upstream call still gets the precise timestamp; the client dedupes any repeated
  trade rows. Responses with `username` are `private` (open orders in body).
- **wallet-estimate-extras**: composites savings/conversions/open orders; 60s/600s; `private`
  (savings withdrawals carry memos).
- **history**: filtered mode honors `limit` — it caps the returned matching items, and when
  truncated the cursor resumes below the oldest RETURNED match so the remainder is paged, never
  skipped. Pagination cursor protocol is client-driven (`use-batch-history`).
- **transaction-header**: block ref + expiration for signing. Short TTL; see 06 for why signing
  still works with cached headers.
- **price**: **removed** (2026-09-22). It read the nonexistent `current_median_history.base_quote`
  and always returned 0 with zero consumers — use `wallet-prices`
  (`SteemService.getWalletPrices`, which parses base/quote correctly).
- **proposals/votes**: getAccounts is chunked in batches of 100 (the accounts-route cap; the
  limit is this app's own convention — steem-js forwards the array as-is). Keyed by
  `hashedCacheKey('cache:query:proposals:votes', proposalId)`; public Cache-Control (voter rows
  are proposal-scoped global data).
- **owner-history**: user-scoped, `private`; cached 15s/300s via withCache like its siblings.

## Degradation protocol details

- `withCache` serves stale on fetcher failure; `isSteemKnownDown()` (health-monitor, Redis-backed)
  short-circuits without an RPC attempt — stale when a cached copy exists, throw (→ 503) when it
  does not. A known-down node is never hammered by cache misses (docs §2.3).
- Single-flight: concurrent identical misses share ONE in-process fetch (per-instance Map of
  pending promises, not a Redis lock). TTL-expiry storms no longer fan out one upstream call per
  concurrent request — do not add per-request upstream reads to short-TTL routes without this.
- `docs/CACHING_AND_DEGRADATION.md` is the intent document; a 2026-09 pass re-synced it with the
  code (§2.5 client-IP order + per-route quota table, §3.3 poll interval 60s). Keep it in sync in
  the same PR when you change behavior.

## Client-side L1 cache (browser)

`lib/cache/client-cache.ts` (LRU-50, entry = `{data, fetchedAt}`) + `client-fetch.ts`
(`cachedFetch(url, {staleMs, maxAgeMs, noStore})`): fresh → return; stale → return stale +
background refresh that **writes the cache but never notifies the caller** (hooks keep rendering
the stale value for that mount). Implications:

- `noStore: true` is the only true bypass. **Do not** emulate it with
  `staleMs:0, maxAgeMs:0` — that still writes already-expired entries into
  the LRU and evicts live ones (the `use-delegations` refetch shipped that
  bug before being switched to `noStore`).
- For "refetch now after an action", the working pattern is `clientCache.invalidate(url)` with the
  exact URL (see `savings-withdraw-history.tsx`), optionally combined with the wallet refresh
  nonce (see 06).

## Degradation signaling — one store, two inputs (wired 2026-09)

- The per-response channel: `X-Degraded: true` responses are read by `cachedFetch` on every
  fetch path (including `noStore` and background refresh) into the global `degradation-state`
  (`setDegraded`); a healthy response writes `setDegraded(false)` — recovery.
- The polling channel: `useServiceHealth` polls `/api/health` every 60s AND subscribes to
  `degradation-state`, merging both: outage > (response-degraded OR poll-degraded) > poll status.
  Effect: a degraded query response shows `DegradationBanner` within its normal render cycle
  (not up to 60s later); the poll remains the backstop for pages that issue no queries; the
  banner hides only when responses are healthy again AND the poll says healthy.
- If you build per-request degraded UX, subscribe to the existing `degradation-state` store
  instead of inventing a third channel (and beware HTTP-cache interactions: a
  `private, max-age=15` response makes post-action refresh() serve cached bodies — the
  proposals vote-toggle staleness bug).
