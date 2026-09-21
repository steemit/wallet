# AI-Driver Docs — Module Reference for AI Agent Development

These documents are written for **AI agents (and new contributors) implementing features** in this
repository. Their purpose is to give you the module-level map, the invariants you must not break,
and — most importantly — **the pitfalls that have already been hit**, so you do not rediscover them
the hard way.

> Status date: 2026-09-21, baseline `next@3accbe10`. Cross-checked against a full logic-consistency
> review (see `~/workspace/agent-share/wallet/next/global-consistency-review-2026-09-21.md`).
> When code and these docs drift, **trust the code** and update the doc in the same PR.

## Reading order

| Doc | Covers | Read it before… |
|-----|--------|-----------------|
| [01-architecture.md](01-architecture.md) | Relay philosophy, three-layer security model, module map | touching anything server-side |
| [02-auth.md](02-auth.md) | Challenge-login, CSRF, client auth state, key handling | touching login, auth, or anything that reads private keys |
| [03-broadcast.md](03-broadcast.md) | Broadcast relay routes, how to add one | adding/changing any `/api/broadcast/*` route |
| [04-query-cache.md](04-query-cache.md) | Query routes, `withCache`, cache keys, rate limiting, degradation | adding/changing any `/api/query/*` route or cache behavior |
| [05-recovery.md](05-recovery.md) | Account recovery state machine, CAS, conveyor/kingdom | touching `/api/recovery/**` or `recover-account` |
| [06-frontend.md](06-frontend.md) | Hooks, client cache, Redux reality, signing, wallet logic | touching components, hooks, or client data flow |
| [07-infra-config.md](07-infra-config.md) | proxy.ts, CSP, env vars, Docker, telemetry, i18n | touching middleware, config, deployment |
| [08-testing.md](08-testing.md) | Vitest/Playwright conventions, mock discipline | writing or modifying any test |

## The five rules that supersede everything else

1. **The server is a dumb relay for broadcasts.** It manages traffic (rate limit, CSRF, cache) and
   does **not** validate transaction content — the chain validates. Do not add "one more safety
   check" to a broadcast route. See 01-architecture.md for why this is load-bearing.
2. **Private keys never leave the client.** No key material in requests, logs, Redux-unsafe
   actions, or server code. The only server-held key is `CONVEYOR_POSTING_WIF` (recovery only).
3. **Fail closed where the server holds state.** Login challenges and recovery must reject when
   Redis/DB are unavailable. Pure read caches may degrade to direct upstream fetch.
4. **Comments, docs under `docs/`, commit messages, and error strings are English.**
5. **Never commit without explicit user approval.** Run `pnpm verify` before proposing a commit.

## Known-broken machinery (do not build on these until fixed)

These are documented in detail in the review report; agents must not *assume* they work:

- **`use-auth.ts`'s `login` and the `wallet`/`ui` Redux slices are dead code.** Do not call them;
  the only live login entry point is `LoginForm`. See 06-frontend.md.
- **`/api/query/price` returns a constant 0** (reads a nonexistent field) and has no consumers.
  Do not use it; use `/api/query/wallet-prices`. See 04-query-cache.md.

Post-broadcast cache invalidation was in this category until 2026-09-21; it now works as
documented in 03-broadcast.md §"Cache invalidation after broadcast" and 04-query-cache.md —
follow those contracts exactly (hashed prefixes server-side, `invalidateWalletCache` +
nonce client-side) when adding routes or broadcast success paths.

The recovery confirm CAS was in this category until 2026-09-22 (fixed by PR #340): the route
read `affectedRows` off the raw drizzle mysql2 tuple, so recovery step 2 never worked against
real MySQL and bricked records into `processing`. It now reads the count via
`mysqlAffectedRows()` (`src/lib/db/affected-rows.ts`) and rolls the claim back on unreadable
shapes — see 05-recovery.md §"P0 fixed (2026-09-22)" before touching any CAS in `/api/recovery/**`.
