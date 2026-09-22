# 07 — Infrastructure & configuration

## `src/proxy.ts` (Next.js 16 middleware — file name is `proxy.ts`, NOT `middleware.ts`)

Runs on every non-API path (matcher excludes `api`, `_next`, `_vercel`, plus names of things that
don't exist — trpc/robots/sitemap — harmless legacy). Responsibilities, in order:

1. `/.well-known/healthcheck.json` short-circuit — **liveness only**, `{status:'ok'}`, used by
   ELB/OpenResty. Deliberately leaks nothing else.
2. Static-asset pass-through via last-segment extension regex (needed because Steem sub-account
   names contain dots, so the matcher can't use "contains a dot"). Edge case: a bare
   `/user.png`-style account URL (no `@`) is treated as a static file → 404.
3. `/@account/... → /account/...` normalization (Next.js treats `@` segments as parallel-route
   slots; pages additionally strip a leading `@` from the param).
4. Per-request CSP nonce (`x-nonce` request header + `Content-Security-Policy` response header);
   nonce + `'strict-dynamic'` is what lets framework inline scripts run while blocking injection.
   The nonce must be attached to the *request* headers **before** the intl middleware builds its
   rewrite response.
5. Rolling CSRF cookie on every document response (Web Crypto HMAC, byte-identical to
   `csrf.ts`; see 02-auth).
6. Hand-off to next-intl middleware (`localePrefix: 'never'`, locales en/zh/es).

When modifying CSP: remember `img-src https:` is intentionally wide (on-chain profile images),
`connect-src` covers GA only, and any new external origin needs both
the header and an audit of what loads it.

## Environment variables

Authoritative list = code; `.env.example` and `docker/docker-compose.yml` are kept
in sync with it by `tests/unit/infra-single-source.test.ts`. Highlights:

| Variable | Notes |
|----------|-------|
| `STEEM_RPC_URL` | comma-separated failover list (single URL = single node, no amplification) |
| `REDIS_URL` / `REDIS_KEY_PREFIX` | prefix defaults `wallet`; the multi-instance isolation knob |
| `DATABASE_URL` | recovery only; no hardcoded fallback (drizzle.config.ts included) |
| `CSRF_SECRET` | production-required; missing = all mutations fail closed |
| `CONVEYOR_USERNAME` / `CONVEYOR_POSTING_WIF` | recovery signing; missing → confirm 503s cleanly |
| `TRUST_PROXY_COUNT` | rightmost-N XFF selection for `getClientIP` (S6) |
| `RATE_LIMIT_AUTH_CHALLENGE_MAX/_WINDOW` | the **only** live rate-limit env knobs |
| `RATE_LIMIT_ALLOW_MEMORY_FALLBACK` | set false on multi-instance prod (memory buckets aren't shared) |
| `GOOGLE_ANALYTICS_ID` / `SDC_GOOGLE_ANALYTICS_ID` | runtime-injected gtag; illegal IDs ignored; `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` exists as a build-time fallback (requires rebuild — despite .env.example's promise) |
| `STEEM_WHALE` / `SBD_WHALE` | overseer user_action thresholds |
| `OTEL_*` / `WALLET_TELEMETRY_*` / `OTEL_SDK_DISABLED` | standard OTel vars are read as fallbacks |
| `SESSION_SECRET` | declared, **unused** (no server sessions) |

**docker-compose.yml** passes only variables the code reads (guarded by
`tests/unit/infra-single-source.test.ts`, which fails if compose passes an
undocumented variable or omits a required one). Secrets are env-var
references, never literals.

## Health checks — two different semantics

- `/.well-known/healthcheck.json` (proxy) = liveness. Use for LBs and
  container health checks (Dockerfile HEALTHCHECK, compose healthcheck, and
  the ELB all use it).
- `/api/health` = readiness: probes the Steem RPC (probe-locked, cached via
  Redis health state) and returns 503 when degraded. For humans/monitoring
  only — never wire it to container liveness, or an upstream Steem outage
  marks every container unhealthy.

## Docker / builds

- **Single Dockerfile truth**: `docker/Dockerfile` is the canonical recipe;
  the root `./Dockerfile` is a byte-identical copy required by the external
  CodeBuild pipeline (orchestration repo runs `docker build .` from the repo
  root). `tests/unit/infra-single-source.test.ts` fails if they diverge —
  edit `docker/Dockerfile`, then re-copy to the root.
- standalone output; container port **8080** (`next start -p 8080` equivalent via ENV PORT).
- pnpm is anchored: `packageManager` in package.json is the single source of
  truth; the Dockerfile corepack pin and CI derive from/must match it (also
  guarded by the same test).
- `pnpm verify` = type-check + lint + coverage + build; run before proposing commits.

## Telemetry (OTel)

- Node runtime only (`instrumentation.ts` gates on `NEXT_RUNTIME === 'nodejs'`). No exporter
  endpoint → no init (fully dormant; `OTEL_SDK_DISABLED` honored).
- Incoming-path ignore list covers the health probes only. High-volume paths (static chunks) are
  not filtered — if trace noise matters, extend `telemetry/ignore.ts` with measurements.
- Self-exported spans are ignored to avoid loops.

## Analytics

- **Live:** GA/gtag runtime-injected; overseer page/action tracking (`overseer-page-tracker`,
  `lib/analytics/overseer-payload.ts`) relayed through `/api/analytics/overseer`.
  `routeTagFromPathname` strips the leading `@` from `/@account` paths (via
  `normalizeSteemUsername`) before the account-name check, so wallet account pages tag as
  `user_index`/`change_password` instead of `not_found`.
- **Removed:** the Mixpanel chain (client module `lib/analytics/index.ts`, the
  `/api/analytics/event` route, `NEXT_PUBLIC_MIXPANEL_TOKEN`, the `tests/mocks/mixpanel-browser.ts`
  vitest alias) was dead code with zero traffic and has been deleted. `docker/docker-compose.yml`
  still carries a `MIXPANEL_TOKEN` ghost variable pending a full compose rewrite. Do not
  reintroduce analytics half-wired — a future backend would need a real dependency, an init call,
  and a CSP `connect-src` entry.

## i18n

- `localePrefix: 'never'`: visible URLs carry no locale; `src/i18n/routing.ts` +
  `request.ts` handle negotiation. Link between pages with bare paths (`/@user/transfers`,
  `/market`) — never hardcode `/en/...`.
- Messages under `src/i18n/messages/{en,zh,es}.json`; en/zh are symmetric, es lags (missing 10
  keys, 2 rendered raw). Always pass `defaultMessage` to `t()`.
- UI copy language rule: code comments/docs/errors English; conversation with the user Chinese
  (AGENTS.md).

## Repo hygiene

- `.multica/` (local AI workflow dir) is untracked and **not** in `.gitignore` — add it (with
  `.zcode/` if used) next time you touch the ignore file.
- `AGENTS.md` is local-only (`.git/info/exclude`) but loaded every session — keep its counts
  accurate (it currently says Next 16.2.4 / 16 broadcast routes; reality was 16.2.11 / 19,
  18 after the 2026-09-22 dead-code removal, and 19 again once claim-reward-balance landed
  the same day).
- Type discipline is excellent (`@ts-ignore` ×1, `as any` ×3) — don't break the streak. Note
  `tsconfig` injects `vitest/globals` into all of src; don't lean on test globals in app code.
