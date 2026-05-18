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
| `X-Cache-Invalidate` | Server → Client | Contains a prefix string; all L1 cache entries matching this prefix are invalidated |

When `X-Degraded: true` is detected, the global degradation state is updated via `setDegraded(true)`.

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

A lightweight global state module for tracking whether the server is serving stale/degraded data.

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

1. No Redis → execute fetcher directly, return `{ data, degraded: false }`
2. Fresh data in Redis (`age ≤ ttl`) → return immediately
3. If Steem is known down → skip RPC, return stale data if available
4. Try fetcher → success → cache result, mark Steem healthy, return
5. Try fetcher → failure → mark Steem unhealthy, return stale data if available
6. No stale data available → throw (caller returns 503)

### 2.4 TTL Strategy Per Data Type

| Endpoint | Redis Key | TTL (fresh) | Stale TTL | Cache-Control Header | Rationale |
|----------|-----------|-------------|-----------|---------------------|-----------|
| accounts | `cache:query:accounts:{names}` | 10s | 300s (5m) | `public, s-maxage=10, stale-while-revalidate=60` | Balances change per transaction |
| global-props | `cache:query:global-props` | 3s | 300s (5m) | `public, s-maxage=3` | Matches Steem block interval |
| wallet-prices | `cache:query:wallet-prices` | 60s (1m) | 600s (10m) | `public, s-maxage=60, stale-while-revalidate=120` | Market prices |
| price | `cache:query:price` | 60s (1m) | 600s (10m) | `public, s-maxage=60` | Feed price |
| median-history-price | `cache:query:median-history-price` | 60s (1m) | 600s (10m) | `public, s-maxage=60` | Median feed price |
| witnesses | `cache:query:witnesses:{limit}` | 600s (10m) | 1800s (30m) | `public, s-maxage=600, stale-while-revalidate=1800` | Rarely changes |
| wallet-estimate-extras | `cache:query:wallet-estimate-extras:{username}:{includeOpenOrders}` | 60s (1m) | 600s (10m) | `public, s-maxage=60` | Savings, orders, conversions |
| withdraw-routes | `cache:query:withdraw-routes:{username}` | 60s (1m) | 600s (10m) | `public, s-maxage=60` | Per-user routing |

**Why two layers of TTL?** Cache-Control headers help CDN/edge caches (if deployed). Redis TTL + staleTtl protects against upstream failures at the application level. They are complementary, not redundant.

### 2.5 Rate Limiting

**File:** `src/lib/middleware/rate-limit.ts`

Rate limiting uses Redis `INCR` + `EXPIRE` (fixed-window counter) when Redis is available, with an in-memory Map fallback.

**Redis rate limit key pattern:** `ratelimit:{ip}:{action}:{windowStart}`

**In-memory fallback:** Cleans up expired entries every 5 minutes via `setInterval`.

**Rate limits per endpoint:**

| Route | Action | `maxRequests` | `windowSeconds` |
|-------|--------|---------------|-----------------|
| accounts | `query` | 100 | 60 |
| global-props | `query` | 60 | 60 |
| wallet-prices | `query` | 30 | 60 |
| price | `query` | 30 | 60 |
| median-history-price | `query` | 60 | 60 |
| witnesses | `query` | 30 | 60 |
| wallet-estimate-extras | `query` | 30 | 60 |
| withdraw-routes | `query` | 60 | 60 |
| history | `query` | 50 | 60 |
| transfer | `transfer` | 10 | 60 |
| convert | `convert` | 10 | 60 |
| power-down | `power-down` | 5 | 60 |
| delegate | `delegate` | 10 | 60 |
| witness-vote | `witness-vote` | 10 | 60 |
| vote | `vote` | 10 | 60 |
| set-withdraw-vesting-route | `set-route` | 10 | 60 |

**Client IP detection order:** `x-forwarded-for` → `x-real-ip` → `cf-connecting-ip` → `"unknown"`

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
| Usage | One-time — deleted after successful verification |

**Flow:**
1. Challenge route generates a challenge and stores it in Redis
2. Login route retrieves the challenge from Redis
3. After signature verification, the challenge is deleted (prevents replay)

**Limitation:** Keyed by username — simultaneous login attempts from multiple devices for the same user will overwrite each other. Acceptable for a wallet application.

### 2.7 Cache Invalidation After Broadcast

All broadcast routes (`transfer`, `convert`, `delegate`, `power-down`, `set-withdraw-vesting-route`, `vote`, `witness-vote`) invalidate caches after a successful transaction:

**Redis invalidation:**
```typescript
await cacheDeleteByPrefix('cache:query:accounts');
await cacheDeleteByPrefix(`cache:query:wallet-estimate-extras:${username}`);
await cacheDeleteByPrefix(`cache:query:withdraw-routes:${username}`);
```

**Client invalidation:**
```typescript
response.headers.set('X-Cache-Invalidate', username);
```

The `cachedFetch` function reads `X-Cache-Invalidate` from responses and calls `clientCache.invalidate(username)` to clear matching L1 entries.

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
| `markSteemHealthy(blockNumber?, latency?): Promise<void>` | Marks Steem as healthy with optional metadata |
| `markSteemUnhealthy(error?: string): Promise<void>` | Marks Steem as unhealthy with error message |
| `isSteemKnownDown(): Promise<boolean>` | Returns `true` if health exists and `healthy === false` |

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

Polls `/api/health` every 30 seconds to drive the degradation banner.

| Parameter | Value |
|-----------|-------|
| Poll interval | 30 000 ms (30s) |
| Visibility behavior | Pauses polling when page is hidden; resumes + immediate check on visible |

**Status type:** `'healthy' | 'degraded' | 'outage' | 'unknown'`

### 3.4 Degradation Banner

**File:** `src/components/layout/degradation-banner.tsx`

Rendered in `AppLayout` between `<Header>` and `<SidePanel>`.

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
| `src/hooks/use-service-health.ts` | 3 | Health polling hook |
| `src/hooks/use-account-data.ts` | 1 | Account data with L1 cache |
| `src/hooks/use-steem-wallet-balances.ts` | 1 | Balances with L1 cache |
| `src/hooks/use-wallet-estimated-value.ts` | 1 | Estimated value with L1 cache |
| `src/lib/wallet/use-rewards-history.ts` | 1 | Rewards history with L1 cache |
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
| `tests/unit/rate-limit-redis.test.ts` | 2 | Redis rate limit + in-memory fallback |
| `tests/unit/health-monitor.test.ts` | 3 | Health tracking, TTL, known-down check |
| `tests/unit/degradation-banner.test.tsx` | 3 | Banner rendering per status |
| `tests/unit/rewards-history.test.ts` | 1 | Rewards history cache save/restore |
| `tests/unit/use-rewards-history.test.tsx` | 1 | Hook integration |
