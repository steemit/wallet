# 08 — Testing conventions & mock discipline

## Layout & commands

```
tests/unit/*.test.{ts,tsx}     Vitest (jsdom), the vast majority
tests/e2e/smoke.spec.ts        Playwright; CI runs with workers=1 (CI=true)
tests/mocks/steem-js.ts        aliased for '@steemit/steem-js' (loads REAL auth helpers from node_modules)
```

- `pnpm test` / `pnpm test:coverage` — coverage thresholds: lines/functions/statements 80%,
  branches 60%.
- `pnpm verify` before proposing a commit (type-check + lint + coverage + build).

## Mocking rules (singletons)

`getDb()` and `getRedis()` are lazily-initialized singletons — unit tests must mock the modules:

```ts
vi.mock('@/lib/db', () => ({ getDb: vi.fn(/* return mock drizzle db or null */) }));
vi.mock('@/lib/cache/redis', () => ({ getRedis: vi.fn() /* null = degraded path */ }));
```

`@steemit/steem-js` is already aliased globally in `vitest.config.ts` —
never mock it per-file.

## Route tests — the pattern

See `tests/unit/proposals-broadcast-routes.test.ts` / `recovery-confirm-route.test.ts`:

- Construct `NextRequest` with method/headers/body; include `X-CSRF-Token` or mock
  `@/lib/middleware`'s `verifyCSRF` to return null.
- Mock `rateLimit` to resolve null (or test limit rejections separately).
- Mock `SteemService` methods (`vi.mock('@/lib/steem/server')`).
- Assert status codes, response bodies, and — for recovery — the exact drizzle call sequences
  (there are existing tests asserting rendered SQL, e.g. F15).

## ⚠️ The #1 testing pitfall in this repo: mock contracts that don't match reality

This codebase has produced a **P0 shipped bug** through this exact failure mode, plus three more
masked defects. The pattern: a unit test mocks a dependency with a plausible-but-wrong shape, CI
stays green, production breaks.

| Incident | Mock said | Reality |
|----------|-----------|---------|
| Recovery CAS (P0) | `db.update().where()` resolves `{affectedRows: 1}` | drizzle mysql2 resolves `[ResultSetHeader, FieldPacket[]]` → `.affectedRows` undefined |
| Client cache invalidation | keys like `user:alice:balance`, header `user:alice:` | keys are URLs (`/api/query/...`), header is a bare username — never matches |
| Overseer route tags | pathname `/alice/transfers` | the app only ever produces `/@alice/transfers` → `not_found` |
| CSP nonce forwarding | intl middleware mocked to forward mutated request headers | real middleware behavior untested |

Rules that follow from this history:

1. **When mocking a dependency's return shape, derive the mock from the real implementation**
   (read `node_modules/<dep>` or the real module), not from what the code-under-test expects.
   For drizzle raw updates, the honest mock is an array whose `[0]` is the `ResultSetHeader`.
2. **When a test fabricates strings (keys, paths, header values), grep the production code for
   who actually produces/consumes them.** If nothing in `src/` produces that shape, the test is
   testing a fiction.
3. Integration-sensitive invariants (DB result shapes, real middleware header propagation) need
   at least one test that runs the real dependency — or an e2e case. The recovery flow currently
   has zero e2e coverage; that's why the P0 shipped.
4. A green suite proves the code matches the mocks — nothing more. Treat "all tests pass" on a
   change to mock-heavy code as low evidence.

## What has no tests today (gap map, 2026-09-21)

- `/api/auth/login` and `/api/auth/logout` routes — **zero**. Priority when touching auth:
  fail-closed (Redis null → 503), one-time challenge `del`, `validKeys` matching, malformed JSON → 400.
- 14 of 19 broadcast routes have no route-level tests (the per-route invalidation drift grew in
  exactly these gaps).
- `/api/query/price` (broken, unconsumed — delete instead of testing).
- `csrf.test.ts` lacks the 24h-expiry branch.
- e2e covers only smoke; no recovery, no market order placement.

## Conventions that work well (keep them)

- Security decisions are encoded as tests: S3 authority-tuple rejection, F12 shape bounds before
  ECDSA, F14 route-tree walking (fails CI when a route isn't registered), CSRF cross-runtime
  parity (`proxy-csrf-cookie.test.ts` asserts the edge-minted token verifies under Node crypto).
- Degradation matrices: challenge/login tests enumerate Redis-null, NX-collision, over-limit
  behaviors explicitly.
- When you fix any bug, first add the test that would have caught it — especially for the
  mock-contract class above.
