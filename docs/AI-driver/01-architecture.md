# 01 — Architecture: the dumb-relay model

## What this application is

A browser wallet for Steem accounts (Next.js 16 App Router rewrite of `wallet-legacy`, lives on the
`next` branch): balances, transfers/convert/delegate/power-down, SPS proposal voting, witness
voting, the internal market, and an **account recovery** flow. The server has exactly two jobs:

1. **Relay & protect** — client-signed transactions are POSTed here and forwarded to
   `api.steemit.com`, so the relay can rate-limit, cache, failover, and log. The relay exists to
   *protect the upstream node*, nothing else.
2. **Own the recovery business** — `/api/recovery/*` + `/api/broadcast/recover-account` hold real
   server-side state (MySQL `arecs`) and sign on-chain with `CONVEYOR_POSTING_WIF`. This is the one
   place where the server validates content, and it must stay that way.

## The three-layer security split (do not blur it)

| Layer | Responsible for | Explicitly NOT responsible for |
|-------|-----------------|-------------------------------|
| Relay (this server) | rate limiting, CSRF, audit logging, caching | validating tx content/signatures/op types |
| Chain (`api.steemit.com`) | signature & authority checks, balances, replay protection, op legality | — |
| Client | private key custody, tx construction, local signing | — |

### Why there is no server-side validation layer (history you must not repeat)

In 2026-08 a validation layer (op-type allowlists, `OP_AUTHORITY` maps, real signature verification)
was added and then **deliberately removed** (`docs/RELAY_ROLLBACK_IMPACT.md`). The recorded reasons:

1. **It fought the traffic goal.** Server-side verification pulled account data per broadcast
   (2 upstream RPCs per request) — doubling load on the node we exist to protect.
2. **It manufactured vulnerabilities.** Checks that only look at `operations[0]`, ignore
   `weight_threshold`, etc. can never match the freedom of client-constructed transactions — every
   guessy check became a bypass primitive (audit findings F5/F8/F10/F11/F12/S4 all lived *inside*
   the validation layer).
3. **The chain is the final validator.** An invalid transaction is rejected by the chain anyway;
   moving that rejection a few milliseconds earlier is worth less than the complexity it costs.

**Rule: when adding a broadcast route, the shape check rejects obvious garbage (wrong field types,
absent required fields) and nothing more.** If you feel the urge to "check content for safety",
re-read this section.

## Module map

```
src/proxy.ts                     Next.js 16 middleware (NOT middleware.ts): healthcheck short-circuit,
                                 /@account normalization, CSP nonce, rolling CSRF cookie, then next-intl
src/app/api/auth/*               challenge / login / logout (stateful login, Redis-backed challenges)
src/app/api/broadcast/*          19 relay routes (client-signed tx in, relay out)
src/app/api/query/*              17 read-only chain queries with Redis stale-while-error caching
src/app/api/recovery/*           account recovery (MySQL + conveyor/kingdom; real server business)
src/app/api/analytics/*          overseer relay (live) + /analytics/event (dead Mixpanel chain)
src/lib/steem/client.ts          CLIENT: SteemSigner (local signing) + apiClient (fetch wrappers)
src/lib/steem/server.ts          SERVER: SteemService — upstream calls, failover, challenge verify,
                                 recovery signing; ~1100 lines, the single upstream gateway
src/lib/middleware/              csrf.ts, rate-limit.ts, cache-invalidate.ts
src/lib/cache/                   redis.ts (lazy singleton), server-cache.ts (withCache), cache-key.ts,
                                 client-cache.ts / client-fetch.ts (browser L1)
src/lib/db/                      drizzle pool singleton + schema (arecs only)
src/lib/store/                   Redux: auth slice (live), wallet & ui slices (dead code)
src/hooks/                       data-fetching hooks (the real client data layer)
src/lib/wallet/                  wallet domain logic + (historically misplaced) history hooks
src/i18n/                        next-intl, locales en/zh/es, localePrefix 'never'
```

## Upstream interaction model

- `STEEM_RPC_URL` is a **comma-separated failover list**. `withFailover` (server.ts:60-76) walks
  URLs on error and keeps a sticky `currentUrlIndex`.
- **Pitfall (known issue):** failover has **no error classification** — deterministic chain
  rejections (bad signature, insufficient balance) are retried against every configured node.
  With a single RPC URL (the default) this is invisible; with N nodes, each garbage tx costs N
  upstream calls. Do not add new retry loops on top of this; if you need one, add classification
  first.
- Every steem-js call has a 30s timeout (jsonRpc default in steem-js v1.2).
- `collectOverseer` (analytics relay) deliberately does NOT failover — read its comment before
  touching it.

## Fail-open vs fail-closed — the decision table

| Subsystem | Redis/DB unavailable | Rationale |
|-----------|---------------------|-----------|
| Write-path rate limiting | memory fallback if `RATE_LIMIT_ALLOW_MEMORY_FALLBACK` (default true), else 503 | memory buckets are per-instance; multi-instance deployments must set the flag false |
| Login (`/api/auth/login`) | **503, always reject** | challenge lives in Redis; without it "verification" is meaningless |
| Login (`/api/auth/challenge`) | skips storage, still returns 200 (known asymmetry, D-4) | un-stored challenges can never verify |
| Read caches (`withCache`) | run fetcher directly | read-only degradation is safe |
| Recovery endpoints | **503, always reject** | server-side state machine must not guess |

## Cross-repository contract (see AGENTS.md registry)

- `steem-js` (`~/workspace/steem-js`) serialization/signing changes affect BOTH `client.ts` and
  `server.ts` verify paths; tests alias it to `tests/mocks/steem-js.ts` (loads real auth helpers).
- `kingdom` / `conveyor` API changes require syncing `/api/recovery/**` and re-running
  `tests/unit/recovery-*.test.ts`.
- Security-sensitive changes: cross-check `~/workspace/steem-audit/projects/wallet/`.
- Legacy behavior questions: `~/workspace/wallet-legacy` is the authority (Sequelize models +
  migrations), but note it has its own internal inconsistencies — compare against its *migrations*,
  not just models (see 05-recovery.md pitfalls).

## Pitfalls already hit at this layer

- **Validation-layer re-growth.** Every "small extra check" on broadcast content has historically
  become a vulnerability. The custom-json id allowlist and payload size limits were removed on
  purpose (2026-08-15 review).
- **Rate-limit uniformity.** All broadcast routes use the same quota (10/min/IP); only
  `recover-account` differs (3/min) as a recovery-business exception. Per-op-type quotas would
  require route↔op binding, which the relay deliberately does not do.
- **Docs drift.** `AGENTS.md`/`docs/` counts (Next version, number of routes) lag reality; verify
  against `package.json` and the filesystem when precision matters.
