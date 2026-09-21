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

Known inconsistency to not extend: `accounts` uses a 32-hex truncated digest, `witnesses`/
`proposals/votes` interpolate trusted integers verbatim. Fine for safety, but the mixed styles are
why broadcast-side invalidation drifted (see 03). New routes: use `hashedCacheKey` only.

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
- Quotas: broadcast 10/min, query 30–120/min by route, auth challenge dual-dimension,
  recovery 3–5/min. **Only `auth/challenge` reads env overrides**
  (`RATE_LIMIT_AUTH_CHALLENGE_MAX/_WINDOW`); all other routes hardcode. Ignore the
  `RATE_LIMIT_MAX_*` names in docker-compose — nothing reads them.
- Client IP: `getClientIP()` honors `TRUST_PROXY_COUNT` (rightmost-N of `X-Forwarded-For`) →
  `x-real-ip` → `'unknown'`. **Never** read `x-forwarded-for` directly anywhere else (S6).
  Unset trust count in production logs a warning and collapses everyone into one bucket.
- ⚠️ Known gap: if the Redis *instance exists but commands error* (maxclients/OOM/READONLY),
  the limiter allows the request (neither Redis nor memory fallback ran). The 'close' event
  nulls the singleton so plain disconnections are handled; command-level failures are not.

## Response protocol — follow the majority shape

- Body: `{ success: true, <data>, degraded?: true, staleAge?: number }`.
- Headers: `Cache-Control` always; `X-Degraded: true` when degraded.
- Error: upstream-down with no stale → **503** with `{ error, degraded: true }`. (Four routes
  still return 500 — history/market/vesting-delegations/expiring-… — don't copy them.)
- `Cache-Control` choice: `public, s-maxage=<ttl>, stale-while-revalidate=<staleTtl>` for global
  data; `private, max-age=…` when the body contains user-specific rows (proposals does this for
  `username`-scoped responses). market / wallet-estimate-extras / withdraw-routes currently ship
  user-scoped bodies with `public` — do not replicate; treat proposals' pattern as the rule.
- Username params: normalize once at the top (`trim().replace(/^@/,'').toLowerCase()`). Routes
  currently disagree (market lowercases, withdraw-routes doesn't, history doesn't at all) →
  same account = multiple cache keys. Be the normalized one.

## Per-route notes

- **accounts**: max 100 names per request (upstream constraint); balances/authority source of
  truth. Multiple frontend callers with different cache params (see 06) — prefer adding a shared
  hook over a 7th fetch site.
- **global-props**: 3s TTL (block-time-sensitive).
- **market**: fans out 4 upstream RPCs per miss (orderbook+ticker+trades+openOrders). Cache key
  includes `since` for logged-in polling, which makes the cache per-user/per-round — the "DoS
  amplifier" comment only really protects anonymous traffic. Validate/clamp `since` if you touch it.
- **wallet-estimate-extras**: composites savings/conversions/open orders; 60s/600s.
- **history**: filtered mode ignores `limit` after validating it (returns up to 100); pagination
  cursor protocol is client-driven (`use-batch-history`).
- **transaction-header**: block ref + expiration for signing. Short TTL; see 06 for why signing
  still works with cached headers.
- **price**: **broken** (reads nonexistent `current_median_history.base_quote`, always 0) and has
  zero consumers — use `wallet-prices` (`SteemService.getWalletPrices`, which parses base/quote
  correctly). Do not wire anything to `/api/query/price`.
- **proposals/votes**: passes 200 names to `getAccounts` in one call while the accounts route
  caps at 100 — unverified against the real upstream limit; if it breaks, chunk it.

## Degradation protocol details

- `withCache` serves stale on fetcher failure; `isSteemKnownDown()` (health-monitor, Redis-backed)
  short-circuits to stale without an RPC attempt **only when stale exists** — with no cached copy
  it still tries the fetcher (known deviation from docs §2.3).
- There is no request coalescing/single-flight: TTL-expiry storms each hit upstream once per
  concurrent miss. Keep this in mind for any new high-traffic read.
- `docs/CACHING_AND_DEGRADATION.md` is the intent document but has drifted (key table shows
  plaintext usernames; §2.5 documents the pre-S6 IP order including a `cf-connecting-ip` that
  doesn't exist; power-down quota outdated; health polling 30s vs 60s). Code wins; update the doc
  in the same PR when you change behavior.

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

## Degradation signaling — two mechanisms, one wired

- `X-Degraded: true` responses are read by `cachedFetch` into a global `degradation-state`
  (`setDegraded`) — but **nothing subscribes to it** (`subscribeToDegradation`/`isDegraded` have
  zero consumers, and `CachedFetchResult.degraded` is read by no caller). The only user-visible
  degradation UI is `DegradationBanner` → `useServiceHealth` polling `/api/health` every 60s.
  If you build per-request degraded UX, subscribe to the existing state instead of inventing a
  third channel (and beware HTTP-cache interactions: a `private, max-age=15` response makes
  post-action refresh() serve cached bodies — the proposals vote-toggle staleness bug).
