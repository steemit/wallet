# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # Start Next.js dev server (localhost:3000)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm type-check       # TypeScript check (tsc --noEmit)
pnpm test             # Run unit tests (Vitest)
pnpm test:coverage    # Unit tests with coverage report
pnpm e2e              # Playwright E2E tests (requires dev server)
pnpm e2e:ui           # Playwright UI mode
```

Run a single unit test file:
```bash
pnpm vitest run tests/unit/auth-slice.test.ts
```

## Architecture

**Steem blockchain wallet** built on Next.js 16 App Router. Users authenticate with a Steem username and private key; private keys never leave the browser.

### Request flow

1. Browser → Next.js API routes (`src/app/api/`) for all blockchain operations
2. API routes apply CSRF + rate-limit middleware before calling `SteemService`
3. Broadcast transactions: client signs via `SteemSigner` (client-side) → posts signed tx to `/api/broadcast/*`
4. Queries: browser calls `/api/query/*` → server-side `SteemService` connects to RPC nodes with failover

### Key separation: client vs server Steem code

- [src/lib/steem/client.ts](src/lib/steem/client.ts) — `SteemSigner` (key-based tx signing, browser only) + `apiClient` helper
- [src/lib/steem/server.ts](src/lib/steem/server.ts) — `SteemService` (queries + broadcast, server only, multi-node failover)

### State management

Redux Toolkit with three slices in [src/lib/store/slices/](src/lib/store/slices/):
- `auth` — username, private keys, isAuthenticated, challenge
- `wallet` — balances and account history
- `ui` — theme, open modals

Private keys are stored in Redux but excluded from serialization checks via custom middleware.

### Routing

Next.js App Router with locale prefix: `src/app/[locale]/`. Locales: `en`, `zh`, `es` (default: `en`) via next-intl. Translation files live in [src/i18n/messages/](src/i18n/messages/).

Dynamic route `[locale]/[username]/` renders the wallet dashboard for a given Steem account. Modal state (open transfer/delegate forms etc.) is encoded in URL search params via [src/lib/wallet/wallet-modal-search-params.ts](src/lib/wallet/wallet-modal-search-params.ts).

### API routes

All under `src/app/api/`:
- `auth/` — login challenge, session creation/destruction
- `broadcast/` — transfer, delegate, power-down, witness vote, convert SBD, withdraw routes
- `query/` — account data, history, global properties, price feed, witness list
- `analytics/` — Mixpanel event forwarding
- `health/` — health check

### Middleware

[src/lib/middleware/](src/lib/middleware/) is applied in API route handlers (not Next.js `middleware.ts`):
- `csrf.ts` — verifies CSRF token on mutating requests
- `rate-limit.ts` — separate in-memory buckets for `query`, `broadcast`, and `auth` endpoints

### Testing

- **Unit tests**: Vitest + jsdom, files in `tests/unit/`. External libs (`@steemit/steem-js`, `mixpanel-browser`) are aliased to mocks in `tests/mocks/`.
- **E2E tests**: Playwright (Chromium only), files in `tests/e2e/`. Playwright auto-starts the dev server.
- Coverage thresholds: 80% lines/functions/statements, 60% branches.

### UI

shadcn/ui components (Radix Nova style) in [src/components/ui/](src/components/ui/). Wallet-specific forms and display components live in [src/components/wallet/](src/components/wallet/). Tailwind CSS 4 for all styling.

### Environment variables

See `.env.example`. Key vars: `STEEM_RPC_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `NEXT_PUBLIC_MIXPANEL_TOKEN`, `NEXT_PUBLIC_SIGNUP_URL`.

### CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push to `master` and `next`: type-check → lint → unit tests + coverage → build → E2E.
