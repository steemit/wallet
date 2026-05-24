# TEMP: `/api/health` scaling follow-up (next PR)

> **Status:** Deferred — remove or merge into `docs/CACHING_AND_DEGRADATION.md` when fixed.  
> **Related:** Phase 3 degradation UI (`src/app/api/health/route.ts`, `src/hooks/use-service-health.ts`, `src/lib/cache/health-monitor.ts`)

## Problem

`GET /api/health` performs a **full Steem RPC** (`get_dynamic_global_properties` via `checkSteemNodeHealth`) on **every request**. It writes `health:steem` to Redis but does **not read** Redis before probing.

The browser polls this endpoint from `useServiceHealth` in `AppLayout` every **30s** per tab (paused when hidden). At scale:

- Steem RPC load ≈ `(concurrent users × open tabs) / 30s` (e.g. 10k users ≈ ~330 RPC/s for health alone).
- Redis `SET health:steem` on every poll (secondary).
- No rate limit on `/api/health`.

Redis `isSteemKnownDown()` helps **other** routes skip RPC when unhealthy; it does **not** reduce health-endpoint amplification.

## Current behavior (reference)

| Component | Behavior |
|-----------|----------|
| `src/app/api/health/route.ts` | RPC probe → `markSteemHealthy` / `markSteemUnhealthy` → 200 or 503 |
| `src/lib/cache/health-monitor.ts` | `health:steem`, TTL 60s, stale after 60s treated as unknown |
| `src/hooks/use-service-health.ts` | Poll 30s; drives `DegradationBanner` |
| `SteemService.broadcastTransaction` | Unrelated; uses `condenser_api.broadcast_transaction` (fixed in PR #292) |

## Suggested fix (next PR)

1. **Read-through cache on `/api/health`:** If Redis has fresh health (< 60s), return it without RPC; optional `?force=1` or internal cron for active probes.
2. **Split probes:** `GET /api/health/live` (process only, for LB) vs `GET /api/health/ready` or shared Redis-backed Steem status.
3. **Centralize Steem probing:** One probe per instance interval (or dedicated job), not per user session.
4. **Frontend:** Longer poll interval (60–120s), or leader election across tabs (`BroadcastChannel` / `localStorage`).
5. **Rate limit** `/api/health` (per IP or global).

## Acceptance criteria

- [ ] Steem RPC from health checks bounded (not proportional to MAU).
- [ ] Degradation banner still updates within acceptable delay when Steem fails.
- [ ] LB / k8s liveness semantics documented (503 vs Steem outage).
- [ ] Tests for cache-hit path and stale Redis behavior.

## Notes

- Small traffic / dev: current design is fine (explains frequent `GET /api/health` in local logs).
- Do not block change-password / `account_update` work on this item.
