# Multi-Level Caching & Service Degradation

This document describes the three-level caching architecture and degradation strategy implemented across Phases 1–3.

## Architecture Overview

```
Browser (L1) → Redis (L2) → Steem RPC (upstream)
```

| Layer | Location | Pattern | Purpose |
|-------|----------|---------|---------|
| L1 — Client Cache | Browser (module singleton) | Stale-while-revalidate | Avoid redundant fetches during tab navigation |
| L2 — Redis Cache | Server-side (ElastiCache) | Stale-while-error | Serve cached data when upstream fails; shared across EC2 instances |
| L3 — Steem RPC | Upstream | N/A | Source of truth |

All Redis-backed features fall back gracefully when `REDIS_URL` is not configured — the application behaves identically to the pre-cache baseline.

---

## Phase 1: Client-Side Cache (L1)

### 1.1 Browser LRU Cache

**File:** `src/lib/cache/client-cache.ts`

A module-level LRU cache singleton shared across all imports within the same browser tab.

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MAX_ENTRIES` | 50 | Maximum cache entries; oldest evicted when exceeded |

Each entry stores `{ data, staleAt, expiresAt }` — two timestamps that drive stale-while-revalidate behavior.

**API:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get<T>(key: string): { data: T; stale: boolean } \| null` | Returns cached data with staleness flag; expired entries are pruned |
| `set` | `set<T>(key: string, data: T, staleMs: number, maxAgeMs: number): void` | Stores data with two TTLs |
| `invalidate` | `invalidate(prefix: string): void` | Deletes all entries whose key contains the prefix |
| `clear` | `clear(): void` | Empties the entire cache |

### 1.2 Cached Fetch

**File:** `src/lib/cache/client-fetch.ts`

Wraps `fetch()` with the L1 cache to implement stale-while-revalidate.

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `staleMs` | `number` | Milliseconds until data becomes stale (eligible for background refresh) |
| `maxAgeMs` | `number` | Milliseconds until data must be discarded entirely |
| `noStore` | `boolean?` | Skip cache and always fetch fresh |

**Decision flow:**

1. `noStore: true` → bypass cache, fetch, return
2. Fresh cache (`now < staleAt`) → return cached data immediately
3. Stale cache (`staleAt ≤ now < expiresAt`) → return cached data + fire-and-forget background refresh
4. No cache → fetch, cache, return

**Custom HTTP headers consumed:**

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Degraded` | Server → Client | When `true`, the response contains stale data from server-side fallback |

When `X-Degraded: true` is detected (on every fetch path — cached, `noStore`, and background refresh), the global degradation state is updated via `setDegraded(true)`; a later healthy response resets it via `setDegraded(false)`. `useServiceHealth` subscribes to that state, so the banner (§3.4) reacts within the normal render cycle instead of waiting for the next health poll (§3.3).

### 1.3 Client-Side Cache Parameters

Each hook configures its own `staleMs` / `maxAgeMs` based on how quickly the underlying data changes:

| Hook | Data | `staleMs` | `maxAgeMs` | Notes |
|------|------|-----------|------------|-------|
| `useAccountData` | Account info | 10 000 (10s) | 60 000 (60s) | Refetch uses `noStore: true` |
| `useSteemWalletBalances` | Accounts | 10 000 (10s) | 60 000 (60s) | — |
| `useSteemWalletBalances` | Global props | 3 000 (3s) | 30 000 (30s) | Matches block interval |
| `useWalletEstimatedValue` | Wallet prices | 30 000 (30s) | 120 000 (2m) | — |
| `useWalletEstimatedValue` | Estimate extras | 30 000 (30s) | 120 000 (2m) | — |
| `useRewardsHistory` | Accumulated rewards | 30 000 (30s) | 120 000 (2m) | Saves on unmount, restores on mount |

**Rewards history cache key pattern:** `rewards:{username}:{opType}`

The rewards history hook stores its accumulated result array in the L1 cache on unmount and restores it on the next mount for the same user + opType. This avoids re-fetching the first 5 batches when switching between tabs.

### 1.4 Degradation State

**File:** `src/lib/cache/degradation-state.ts`

A lightweight global state module for tracking whether the server is serving stale/degraded data. Written by `cachedFetch` (§1.2) on every network response's `X-Degraded` header; read by `useServiceHealth` (§3.3), which merges it into the status that drives `DegradationBanner` (§3.4).

| Function | Signature | Description |
|----------|-----------|-------------|
| `setDegraded` | `(value: boolean) => void` | Update global degradation flag and notify subscribers |
| `isDegraded` | `() => boolean` | Read current flag |
| `subscribeToDegradation` | `(fn: DegradationListener) => () => void` | Subscribe to changes; returns unsubscribe function |

---

## Phase 2: Redis Integration (L2)

### 2.1 Redis Connection

**File:** `src/lib/cache/redis.ts`

| Config | Value | Description |
|--------|-------|-------------|
| `maxRetriesPerRequest` | 3 | Fail fast per-command |
| `retryStrategy` | `Math.min(times * 100, 2000)`, max 10 retries | Exponential backoff capped at 2s |
| `lazyConnect` | `true` | Only connects on first command |
| `connectTimeout` | 5 000 (5s) | Connection timeout |

When `REDIS_URL` is not set, all Redis functions return `null` or no-op, and the application proceeds without caching — identical to pre-cache behavior.

**Environment variable:** `REDIS_URL=redis://<host>:6379`

### 2.2 Cache Primitives

**Redis key naming convention:** `cache:query:{endpoint}:{params}`

Each cached entry uses a combined TTL of `ttl + staleTtl`:

- **First `ttl` seconds** → fresh data
- **Next `staleTtl` seconds** → stale but usable for fallback

| Function | Signature | Description |
|----------|-----------|-------------|
| `cacheGet<T>` | `(key: string, ttl: number, staleTtl: number) => Promise<CacheEntry<T> \| null>` | Returns `{ data, degraded, staleAge? }` based on remaining TTL |
| `cacheSet<T>` | `(key: string, ttl: number, staleTtl: number, data: T) => Promise<void>` | Stores with `SET key value EX (ttl + staleTtl)` |
| `cacheDeleteByPrefix` | `(prefix: string) => Promise<void>` | `SCAN` + `DEL` matching keys |

### 2.3 Server-Side Cache Wrapper

**File:** `src/lib/cache/server-cache.ts`

```typescript
withCache<T>(key, ttl, staleTtl, fetcher): Promise<WithCacheResult<T>>
```

Returns `{ data: T; degraded: boolean; staleAge?: number }`.

**Decision flow:**

1. No Redis → execute fetcher directly (single-flight), return `{ data, degraded: false }`
2. Fresh data in Redis (`age ≤ ttl`) → return immediately
3. Steem known down → skip the RPC entirely: return stale data if available; with no cached copy, **throw** (caller returns 503) — a known-down node is never hammered by cache misses
4. Try fetcher → success → cache result, return fresh. Concurrent misses for one key share a single upstream call (per-process single-flight — see below)
5. Try fetcher → failure → return stale data if available (`degraded: true`)
6. No stale data available → throw (caller returns 503)

**Single-flight:** `withCache` keeps a per-process `Map` of in-flight promises
keyed by cache key. Concurrent identical misses (e.g. a TTL-expiry storm on a
short-TTL route) coalesce into ONE upstream fetch whose result is shared by
every waiter; the map entry is removed when the flight settles. This is
per-instance only (it is not a Redis lock) — its purpose is to stop N
concurrent requests from becoming N upstream RPCs, not cross-instance
coordination.

### 2.4 TTL Strategy Per Data Type

| Endpoint | Redis Key | TTL (fresh) | Stale TTL | Cache-Control Header | Rationale |
|----------|-----------|-------------|-----------|---------------------|-----------|
| accounts | `cache:query:accounts:{sha256(names)}` | 10s | 300s (5m) | `public, s-maxage=10, stale-while-revalidate=60` | Balances change per transaction |
| global-props | `cache:query:global-props` | 3s | 300s (5m) | `public, s-maxage=3` | Matches Steem block interval |
| wallet-prices | `cache:query:wallet-prices` | 60s (1m) | 600s (10m) | `public, s-maxage=60, stale-while-revalidate=120` | Market prices |
| median-history-price | `cache:query:median-history-price` | 60s (1m) | 600s (10m) | `public, s-maxage=60` | Median feed price |
| witnesses | `cache:query:witnesses:{sha256(limit)}` | 600s (10m) | 1800s (30m) | `public, s-maxage=600, stale-while-revalidate=1800` | Rarely changes |
| market (anonymous) | `cache:query:market:{sha256('-')}:{sha256(since-bucket)}` | 5s | 30s | `public, s-maxage=5, stale-while-revalidate=30` | 4-RPC fan-out per miss; global data only |
| market (username) | `cache:query:market:{sha256(username)}:{sha256(since-bucket)}` | 5s | 30s | `private, max-age=5` | Body includes the user's open orders |
| proposals | `cache:query:proposals:{sha256(status,order,direction,limit,username)}` | 15s | 120s | `public, s-maxage=15, stale-while-revalidate=120` / `private, max-age=15` with username | `upVoted` flags are user-scoped |
| proposals/votes | `cache:query:proposals:votes:{sha256(proposalId)}` | 20s | 60s | `public, s-maxage=20, stale-while-revalidate=60` | Proposal-scoped voter rows (global) |
| wallet-estimate-extras | `cache:query:wallet-estimate-extras:{sha256(username)}:{sha256(includeOpenOrders)}` | 60s (1m) | 600s (10m) | `private, max-age=60` | Savings (with memos), orders, conversions |
| withdraw-routes | `cache:query:withdraw-routes:{sha256(username)}` | 60s (1m) | 600s (10m) | `private, max-age=60` | Per-user routing |
| vesting-delegations | `cache:query:vesting-delegations:{sha256(account)}` | 15s | 120s | `private, max-age=15` | Per-account rows |
| expiring-vesting-delegations | `cache:query:expiring-vesting-delegations:{sha256(account)}` | 15s | 120s | `private, max-age=15` | Per-account rows |
| owner-history | `cache:query:owner-history:{sha256(username)}` | 15s | 300s (5m) | `private, max-age=15` | Per-account owner key history |
| history | `cache:query:history-{fallback,filtered}:{sha256(username[,ops])}` (fallback only, no fresh cache — §3.5) | — | 300s (5m) | `private, no-store` | Per-account rows incl. memos; no fresh window, so no cache may store the body |

User-supplied key components are always full SHA-256 digests (`hashedCacheKey` /
`hashedUserCachePrefix` in `src/lib/cache/cache-key.ts`) — never the raw value.
Static single-value keys (`global-props`, `wallet-prices`, `median-history-price`)
have no components to hash. Key construction was unified 2026-09: `accounts`
previously used a 32-hex truncated digest and `witnesses` / `proposals/votes`
interpolated integers in plaintext. Old-format entries are unreachable but
harmless — they expire by their TTL; no migration is needed.

**Cache-Control choice:** global data → `public, s-maxage=<ttl>,
stale-while-revalidate=<staleTtl>`; user-scoped bodies (username-parameterized
rows, open orders, memos) → `private, max-age=<ttl>` so a shared/CDN cache can
never store one user's rows and serve them to another (§3.6). User-scoped
responses with **no** server-side fresh cache (history, §3.5) →
`private, no-store`: there is no freshness window to advertise, so no cache —
shared or browser — may store or reuse the body.

**Why two layers of TTL?** Cache-Control headers help CDN/edge caches (if deployed). Redis TTL + staleTtl protects against upstream failures at the application level. They are complementary, not redundant.

### 2.5 Rate Limiting

**File:** `src/lib/middleware/rate-limit.ts`

Rate limiting uses Redis `INCR` + `EXPIRE` (fixed-window counter) when Redis is available, with an in-memory Map fallback.

**Redis rate limit key pattern:** `ratelimit:{ip}:{action}:{routeScope}:{windowStart}`

- `{ip}` — client IP resolved by `getClientIP()` (order below).
- `{action}` — the caller-supplied action string (`query`, `broadcast`, `login`, …). Route scoping (next) guarantees isolation even when callers reuse an action.
- `{routeScope}` — `routeScopeOf()` derives the scope from the request path with a **default-deny** policy (F14): every route must be registered in `STATIC_API_ROUTES` (or, for the single dynamic route `/api/recovery/verify/[code]`, collapse to the stable scope `recovery:verify`); anything unrecognized shares one conservative `unregistered` bucket. This keeps attacker-controlled path segments (e.g. the recovery code) out of the key — a rotating param would otherwise mint a fresh counter per request and defeat the limit. A unit test walks `src/app/api` and fails CI when a route is missing from the whitelist.
- `{windowStart}` — the fixed-window bucket index (`floor(now / windowSeconds)`).

Per-user limits (`rateLimitByUser`) use `ratelimit:user:{username}:{action}:{windowStart}` instead.

**Client IP detection (`getClientIP`)** — repo-wide convention (S6): any server-side code needing the client IP goes through this function; never read `x-forwarded-for` / `x-real-ip` directly elsewhere.

1. `TRUST_PROXY_COUNT` set (N > 0): take the **Nth-from-right entry of `X-Forwarded-For`** — the hop appended by our trusted reverse proxy (ELB/OpenResty). Client-supplied front entries cannot spoof the value used. Set `TRUST_PROXY_COUNT` to the number of trusted proxy hops (see `.env.example`).
2. `TRUST_PROXY_COUNT` unset or 0: fall back to **`x-real-ip`**. The reverse proxy sets this header by overwriting any client value, so it is far harder to spoof than the append-only `X-Forwarded-For`. This prevents all clients collapsing into one `'unknown'` bucket when an operator forgets `TRUST_PROXY_COUNT`.
3. Neither available: **`'unknown'`** — all clients share a single bucket (degraded isolation). In production this logs a one-time warning.

There is **no `cf-connecting-ip` handling** — this deployment sits behind ELB/OpenResty, not Cloudflare. (The previous doc described a pre-S6 order that never matched the implementation.)

**Failover semantics:** if the Redis *instance exists but a command fails* (maxclients / OOM / READONLY / auth failure), the limiter does NOT treat the request as allowed — it falls back to the in-memory store, or rejects with 503 when `RATE_LIMIT_ALLOW_MEMORY_FALLBACK=false` (fail-closed). Plain disconnections are handled by the Redis singleton's `'close'` handler (which nulls the instance → same fallback path); command-level failures are handled inside `redisRateLimit` by an explicit `command-error` outcome.

**In-memory fallback:** per-process Map (NOT shared across instances — multi-instance deploys weaken limits while it is active). Expired entries are cleaned every 5 minutes via `setInterval`.

**Rate limits per route** (rebuilt from the actual route handlers):

| Route | Action | Limit |
|-------|--------|-------|
| auth/challenge | `auth_challenge` | 10/min per IP **and** 10/min per username (dual dimension; when the per-username cap trips the still-valid challenge is re-served instead of a hard 429 — a hard 429 would be a targeted auth-DoS). The only route with env overrides: `RATE_LIMIT_AUTH_CHALLENGE_MAX` / `RATE_LIMIT_AUTH_CHALLENGE_WINDOW` |
| auth/login | `login` | 10/min |
| auth/logout | `auth_logout` | 10/min |
| query/accounts | `query` | 100/min |
| query/global-props | `query` | 60/min |
| query/median-history-price | `query` | 60/min |
| query/wallet-prices | `query` | 30/min |
| query/witnesses | `query` | 30/min |
| query/market | `query` | 120/min |
| query/history | `query` | 50/min |
| query/wallet-estimate-extras | `query` | 30/min |
| query/withdraw-routes | `query` | 60/min |
| query/vesting-delegations | `query` | 60/min |
| query/expiring-vesting-delegations | `query` | 60/min |
| query/owner-history | `query` | 30/min |
| query/proposals | `query` | 60/min |
| query/proposals/votes | `query` | 40/min |
| query/proposals/dao-stats | `query` | 30/min |
| query/transaction-header | `query` | 120/min |
| broadcast/* — 18 routes¹ | `broadcast` | 10/min each (per route scope) |
| broadcast/recover-account | `broadcast` | 3/min (recovery exception) |
| recovery/request | `recovery` | 5 per 5 min |
| recovery/verify/[code] | `recovery_verify` | 10 per 5 min |
| recovery/confirm | `recovery_confirm` | 5 per 5 min |
| analytics/overseer | `analytics` | 100/min |

¹ account-create, account-update, cancel-transfer-from-savings, change-recovery-account, claim-reward-balance, convert, custom-json, delegate, limit-order-cancel, limit-order-create, power-down, proposal-create, proposal-remove, proposal-vote, set-withdraw-vesting-route, transfer, witness-proxy, witness-vote. The former `broadcast/vote` route was removed (dead code, 2026-09).

Not rate-limited: `/api/health` (it is the health probe — limiting it would defeat its purpose; it is still registered in `STATIC_API_ROUTES` so any future limiter gets a sane scope).

**Env tunables — reality check:** `rateLimitConfigFromEnv` currently has exactly ONE consumer — the challenge route (`RATE_LIMIT_AUTH_CHALLENGE_MAX` / `RATE_LIMIT_AUTH_CHALLENGE_WINDOW`). Every other route hardcodes its limits in the handler. The ghost `RATE_LIMIT_ENABLED` / `RATE_LIMIT_MAX_QUERY` / `RATE_LIMIT_MAX_BROADCAST` / `RATE_LIMIT_MAX_AUTH` / `RATE_LIMIT_WINDOW_*` names that `docker/docker-compose.yml` used to pass are read by **nothing** and were removed from compose (infra single-source PR); do not reintroduce them there — `tests/unit/infra-single-source.test.ts` fails on undocumented compose variables. The limiter honors only `RATE_LIMIT_AUTH_CHALLENGE_*`, `RATE_LIMIT_ALLOW_MEMORY_FALLBACK`, and `TRUST_PROXY_COUNT`.

**Response headers on 429:**

| Header | Description |
|--------|-------------|
| `Retry-After` | Seconds until the rate limit window resets |
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Remaining requests (always `0` on 429) |

### 2.6 Auth Challenge Storage

**File:** `src/app/api/auth/challenge/route.ts`, `src/app/api/auth/login/route.ts`

Auth challenges are stored in Redis to fix a replay vulnerability and support multi-instance deployments.

| Parameter | Value |
|-----------|-------|
| Redis key | `auth:challenge:{username}` |
| TTL | 300s (5 minutes) |
| Storage | `SET ... EX 300 NX` — a live challenge is never overwritten |
| Usage | One-time — atomically consumed (`GETDEL`) after successful signature verification |

**Fail-closed (both routes REQUIRE Redis):** if Redis is unavailable, the
challenge route refuses to issue a challenge and the login route refuses to
verify; both return `503 Login temporarily unavailable`. Login is never
degraded to public-key-match-only acceptance, and no challenge is handed out
that could not later be verified server-side.

**Flow:**
1. Challenge route generates a challenge and stores it with `SET ... EX 300 NX`.
   If a live challenge already exists (NX loses the race), the request returns
   the SAME stored challenge — a new request never invalidates a value a client
   may currently be signing. Responses carry `Cache-Control: no-store` (and the
   client fetch uses `cache: 'no-store'`) so no intermediary serves a stale
   challenge.
2. Login route reads the challenge from Redis and verifies the client's
   signature against the stored value. A failed signature does NOT consume the
   challenge — the client may retry with the same one.
3. After a successful verify, the challenge is consumed atomically with
   `GETDEL` (Redis ≥ 6.2; deployment baseline is ElastiCache Redis 7+, and
   ioredis ≥ 5 ships the command). Of several concurrent requests presenting
   the same valid signature, exactly one wins the consume; the others get
   `401 Invalid or expired challenge`. This atomicity is what makes the
   one-time/replay guarantee actually hold — the previous `GET` → verify →
   `DEL` sequence let two concurrent replays both pass verification.

**Multi-device behavior (keyed by username):** the key holds ONE live
challenge per username. When device B requests a challenge while device A's is
still live, NX fails and B is handed the already-stored challenge — B does not
mint a second key and cannot overwrite A's. Whichever device submits a valid
signature first consumes the challenge; the other device's login then fails
with `401 Invalid or expired challenge` and it must request a fresh challenge.
This is the deliberate F6/S2 hardening (no overwrite primitive: an attacker
spamming challenge requests can never invalidate the challenge a victim is
about to sign).

### 2.7 Cache Invalidation After Broadcast

Every broadcast route deletes the Redis caches its operation dirties, right
after a successful relay. Two kinds of deletes exist:

**Global prefix deletes** (verbatim trusted prefixes) for data any user's
broadcast can change:

```typescript
await cacheDeleteByPrefix('cache:query:accounts');   // balances/authorities
await cacheDeleteByPrefix('cache:query:market');     // limit-order routes
await cacheDeleteByPrefix('cache:query:proposals');  // proposal routes
await cacheDeleteByPrefix('cache:query:witnesses');  // witness-vote/proxy
```

**Per-user prefix deletes** for user-scoped caches. The username must go
through `hashedUserCachePrefix` — query routes store keys with the username
hashed (`hashedCacheKey`), so interpolating the raw name produces a pattern
that can never match (this exact bug shipped and made every targeted delete
a silent no-op until 2026-09):

```typescript
import { hashedUserCachePrefix } from '@/lib/cache/cache-key';

await cacheDeleteByPrefix(
  hashedUserCachePrefix('cache:query:wallet-estimate-extras', username)
);
```

`hashedUserCachePrefix` normalizes the name (`trim`, strip leading `@`,
lowercase) exactly like the query routes, so both sides hash the same string.
`cacheDeleteByPrefix` appends the trailing `*`, which covers extra key
components (e.g. the `includeOpenOrders` part of wallet-estimate-extras).

Per-route lists (only delete what the op actually dirties — copying the
transfer list into unrelated routes caused drift before):

| Route | Invalidations |
|-------|---------------|
| transfer / convert / power-down / cancel-transfer-from-savings | accounts, extras(user) |
| claim-reward-balance | accounts (claim moves reward_* into balances; savings/conversions/orders untouched) |
| delegate | accounts, vesting-delegations(user), expiring-vesting-delegations(user) |
| set-withdraw-vesting-route | accounts, withdraw-routes(user) |
| limit-order-create / limit-order-cancel | accounts, extras(user), market |
| witness-vote / witness-proxy | accounts, witnesses |
| proposal-vote / proposal-create / proposal-remove | proposals |
| account-update / account-create / change-recovery-account / recover-account | accounts |
| vote / custom-json | (accounts only / none — no wallet caches involved) |

**Client-side (browser L1) invalidation:** there is no server→client
invalidation header (the former `X-Cache-Invalidate` channel never had a
working consumer and was removed). Instead, the broadcast success path on the
wallet page (`[username]/page.tsx` `handleWalletDataChanged`) calls
`invalidateWalletCache(username)` (`src/lib/cache/client-invalidate.ts`),
which drops the exact URL-keyed L1 entries the wallet hooks cached, and then
bumps the refresh nonce so the hooks refetch from the network. This ordering
matters: `cachedFetch` serves its fresh window without a request, so without
the explicit invalidation the nonce alone would keep rendering
pre-broadcast balances.

---

## Phase 3: Degradation UI & Health Monitoring

### 3.1 Health Monitor

**File:** `src/lib/cache/health-monitor.ts`

Tracks Steem RPC health in Redis so all EC2 instances share the same view.

| Parameter | Value |
|-----------|-------|
| Redis key | `health:steem` |
| TTL | 60 seconds |
| Stale threshold | Data older than 60s is treated as unknown |

**API:**

| Function | Description |
|----------|-------------|
| `getSteemHealth(): Promise<SteemHealthStatus \| null>` | Reads current health from Redis |
| `markSteemHealthy(blockNumber?, latency?): Promise<void>` | Marks Steem as healthy ( **`GET /api/health` only** ) |
| `markSteemUnhealthy(error?: string): Promise<void>` | Marks Steem as unhealthy ( **`GET /api/health` only** ) |
| `isSteemKnownDown(): Promise<boolean>` | Returns `true` if health exists and `healthy === false` (read-only for query routes) |

**Health status structure:**
```typescript
interface SteemHealthStatus {
  healthy: boolean;
  checkedAt: number;       // Unix timestamp
  blockNumber?: number;
  latency?: number;        // ms
  error?: string;
}
```

### 3.2 Health Check Endpoint

**File:** `src/app/api/health/route.ts`

**`GET /api/health`**

Checks Steem node connectivity and persists the result to Redis.

| Response | Status Code | Body |
|----------|-------------|------|
| Healthy | 200 | `{ status: "healthy", checks: { steem: { healthy: true, blockNumber, latency } } }` |
| Degraded | 503 | `{ status: "degraded", checks: { steem: { healthy: false, error } } }` |
| Error | 503 | `{ status: "unhealthy", error: "..." }` |

### 3.3 Service Health Hook

**File:** `src/hooks/use-service-health.ts`

Polls `/api/health` every 60 seconds to drive the degradation banner. Maps HTTP 503 with `status: "degraded"` to the amber banner (not full outage).

| Parameter | Value | Description |
|-----------|-------|-------------|
| Poll interval | 60 000 ms (60s) | Backstop for pages that issue no queries |
| Visibility behavior | Pauses polling when page is hidden; resumes + immediate check on visible | |

**Status type:** `'healthy' | 'degraded' | 'outage' | 'unknown'`

**Merged per-response signal (wired 2026-09):** besides polling, the hook
subscribes to the shared degradation state (§1.4), which `cachedFetch` writes
from every response's `X-Degraded` header (§1.2). Merge precedence:

- `outage` (poll could not reach `/api/health` at all) is the strongest signal;
- otherwise any recently observed degraded response yields `degraded`, even
  when the last poll said healthy — a degraded query response shows the banner
  within its normal render cycle instead of up to 60s later;
- recovery requires BOTH signals healthy: the next non-degraded response
  resets the per-response flag (`setDegraded(false)`) AND the poll must say
  healthy. A poll-reported `degraded` keeps the banner up even after
  responses recover (the poll is the backstop; each signal can raise the
  banner, neither alone can lower the other's).

### 3.4 Degradation Banner

**File:** `src/components/layout/degradation-banner.tsx`

Rendered in `AppLayout` between `<Header>` and `<SidePanel>`. Driven by `useServiceHealth` (§3.3), i.e. by the merged health-poll + per-response `X-Degraded` signal — a degraded query response shows the amber banner immediately, without waiting for the next 60s poll.

| Status | Rendered | Style |
|--------|----------|-------|
| `healthy` | Nothing | — |
| `unknown` | Nothing | — |
| `degraded` | Amber banner | `bg-amber-100 dark:bg-amber-900/30 border-b border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200` |
| `outage` | Red banner | `bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700 text-red-800 dark:text-red-200` |

**i18n keys** (namespace: `wallet`):

| Key | English | Chinese | Spanish |
|-----|---------|---------|---------|
| `degradedBanner` | Some data may be delayed. We're experiencing issues connecting to the Steem blockchain. | 部分数据可能延迟，正在尝试连接 Steem 区块链。 | Algunos datos pueden estar retrasados. Estamos experimentando problemas para conectar con la blockchain de Steem. |
| `outageBanner` | Service is temporarily unavailable. Blockchain data cannot be retrieved at this time. | 服务暂时不可用，区块链数据暂时无法获取。 | Servicio temporalmente no disponible. Los datos de la blockchain no se pueden obtener en este momento. |
| `staleDataHint` | Data may not be up to date | 数据可能不是最新的 | Los datos pueden no estar actualizados |

### 3.5 History Fallback

**File:** `src/app/api/query/history/route.ts`

History is **not** cached in Redis with `withCache` because pagination keys (`from` values) create fragmented entries with low hit rates. Instead, a dedicated fallback mechanism is used.

**Strategy:**
- On successful first-page fetch (`from === -1`), the response is saved as `cache:query:history-fallback:{username}` with TTL 300s (5 minutes)
- When `isSteemKnownDown()` returns `true`, the fallback is served immediately (no RPC attempt)
- When an RPC call fails, the fallback is served if available
- Fallback responses include `degraded: true` in the body and `X-Degraded: true` header
- All 200 responses (fresh and degraded) carry `Cache-Control: private, no-store`: rows are
  user-scoped and the route has no fresh-cache TTL to advertise, so neither shared caches nor
  the browser may store the body (§2.4 Cache-Control choice)

### 3.6 Degraded Response Protocol

When the server serves stale/cached data due to upstream failure:

**Response body additions:**
```json
{
  "success": true,
  "data": "...",
  "degraded": true,
  "staleAge": 45
}
```

**Response headers:**

| Header | Value | Description |
|--------|-------|-------------|
| `X-Degraded` | `true` | Signals degraded data to client-side cache |

**Client-side consequence:** `cachedFetch` reads the header on every fetch
path and writes it into the shared degradation state (§1.4); `useServiceHealth`
(§3.3) merges that signal with the `/api/health` poll, so a degraded response
surfaces the amber banner (§3.4) within the normal render cycle. The next
non-degraded response resets the signal (banner hides once the poll is healthy
too).

**Upstream failure with no stale data — unified contract (all `/api/query/*` routes):**
HTTP `503` with body `{ "error": "<message>", "degraded": true }`. Every query
route follows this shape (unified 2026-09; previously a mix of plain 500s,
bare 503s without `degraded`, and double-layer catches whose inner 503 was
shadowed by an outer 500). Routes with dedicated fallbacks (history, §3.5)
serve the degraded 200 first and only fall through to this 503 when no
fallback exists. 4xx validation errors keep the plain `{ error }` shape with
no `degraded` flag.

---

## File Index

| File | Phase | Description |
|------|-------|-------------|
| `src/lib/cache/client-cache.ts` | 1 | Browser LRU cache |
| `src/lib/cache/client-fetch.ts` | 1 | Stale-while-revalidate fetch wrapper |
| `src/lib/cache/degradation-state.ts` | 1 | Global degradation flag |
| `src/lib/cache/redis.ts` | 2 | Redis connection + cache primitives |
| `src/lib/cache/server-cache.ts` | 2 | Stale-while-error cache wrapper |
| `src/lib/cache/health-monitor.ts` | 3 | Steem RPC health tracking |
| `src/lib/middleware/rate-limit.ts` | 2 | Redis-backed rate limiting |
| `src/hooks/use-service-health.ts` | 3 | Health polling hook (merged with per-response degradation signal) |
| `src/hooks/use-account-data.ts` | 1 | Account data with L1 cache |
| `src/hooks/use-steem-wallet-balances.ts` | 1 | Balances with L1 cache |
| `src/hooks/use-wallet-estimated-value.ts` | 1 | Estimated value with L1 cache |
| `src/hooks/use-rewards-history.ts` | 1 | Rewards history with L1 cache |
| `src/components/layout/degradation-banner.tsx` | 3 | Degradation notification banner |
| `src/components/layout/app-layout.tsx` | 3 | Banner integration point |
| `src/app/api/health/route.ts` | 3 | Health check endpoint |
| `src/app/api/query/*/route.ts` | 1+2 | Query routes with caching |
| `src/app/api/broadcast/*/route.ts` | 2 | Broadcast routes with cache invalidation |
| `src/app/api/auth/challenge/route.ts` | 2 | Challenge storage in Redis |
| `src/app/api/auth/login/route.ts` | 2 | Challenge verification from Redis |

---

## Infrastructure Requirements

| Requirement | Phase | Notes |
|-------------|-------|-------|
| `REDIS_URL` env var | 2 | `redis://<host>:6379`; optional — app works without it |
| ElastiCache / Redis 7+ | 2 | Single primary + 1 replica recommended |
| `ioredis` package | 2 | Already in `package.json` |

## Test Coverage

| Test File | Phase | Coverage |
|-----------|-------|----------|
| `tests/unit/client-cache.test.ts` | 1 | L1 cache TTL, stale, max entries, prefix invalidation |
| `tests/unit/client-fetch.test.ts` | 1 | Stale-while-revalidate, header handling |
| `tests/unit/use-account-data.test.tsx` | 1 | Hook integration with cachedFetch |
| `tests/unit/server-cache.test.ts` | 2 | withCache fresh/stale/error paths + no-Redis fallback |
| `tests/unit/rate-limit-redis.test.ts` | 2 | Redis rate limit, command-error fallback/fail-closed, in-memory fallback |
| `tests/unit/health-monitor.test.ts` | 3 | Health tracking, TTL, known-down check |
| `tests/unit/use-service-health.test.tsx` | 3 | Poll path + per-response degradation merge, recovery, precedence |
| `tests/unit/degradation-banner.test.tsx` | 3 | Banner rendering per status |
| `tests/unit/rewards-history.test.ts` | 1 | Rewards history cache save/restore |
| `tests/unit/use-rewards-history.test.tsx` | 1 | Hook integration |
