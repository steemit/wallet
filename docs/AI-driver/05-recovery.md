# 05 — Account recovery (the exception to the relay philosophy)

Recovery is **real server-side business**: the server holds state (MySQL `arecs`), validates
content, and signs on-chain with `CONVEYOR_POSTING_WIF` via conveyor → `kingdom.recovery_account`.
Everything the relay deliberately does NOT do (validation, gating, CAS) is mandatory here.

## Endpoints & state machine

```
POST /api/recovery/request       { account_name, contact_email, owner_key(?) }
  → insert arecs row status='open'           (admin reviews via kingdom tooling)
[admin approval: 'confirmed' + validation_code generated out-of-band]
GET  /api/recovery/verify/[code] → status wording for the step-2 page
POST /api/recovery/confirm       { code, account_name, old_owner_key, new_owner_key, new_owner_authority }
  → CAS: UPDATE arecs SET status='processing' WHERE code+account+status='confirmed'
  → cross-check old_owner_key vs arecs.owner_key (rollback on mismatch)
  → SteemService.requestAccountRecovery(...)   // conveyor/kingdom, signs request_account_recovery
  → UPDATE arecs SET status='closed', old/new owner keys, requestSubmittedAt
POST /api/broadcast/recover-account { signedTx, code, username, new_owner_key }
  → server-side validation (owner-history proof, shape bounds F12, new_owner_key binding)
  → relay the client-signed recover_account tx
  → CAS consume: UPDATE arecs SET status='consumed' WHERE id+status='closed'
```

Frontend: `recover_account_step_1` page → request; `account_recovery_confirmation/[code]` page →
set new password, derive keys, confirm, then broadcast `recover_account`.

## Invariants (must survive any refactor)

1. **Fail closed everywhere**: DB unavailable → 503 on all four endpoints; conveyor config
   missing → 503 + rollback; owner-history fetch failure → reject; empty history → reject.
2. **S3 canonical authority**: `new_owner_authority` must be exactly the single-key authority
   derived from `new_owner_key` (`weight_threshold:1`, empty `account_auths`, one `[key,1]` tuple
   that is a *real array* — object-maps fool `Array.isArray` reads but get dropped by steem-js).
   The server never forwards the client's object; it rebuilds the canonical structure.
3. **new_owner_key three-way binding**: `arecs.new_owner_key` (confirm) ↔ broadcast route's
   `record.newOwnerKey !== newKey` rejection ↔ on-chain request authority. All three must name the
   same key.
4. **F12 bounds before any synchronous ECDSA**: `validateRecoveryTransactionShape` caps
   signatures ≤ 4, ops ≤ 10, 130-hex signatures — checked *before* signature verification so
   garbage can't DoS the CPU. Do not reorder.
5. **Owner-history proof**: the claimed historical owner key must be in the real on-chain
   owner-history key set, and the tx signature must verify against it (server compares against
   the *normalized* transaction digest, matching what will be broadcast).
6. **CAS discipline**: every status transition is a conditional UPDATE (`WHERE status='<expected>'`)
   counting affected rows; `processing` claims must roll back to `confirmed` on failure paths.
   The same discipline governs the lifecycle helpers (`src/lib/recovery/lifecycle.ts`): lazy
   expiry (`confirmed|processing` older than 24h → terminal `expired`) and the bounded
   stuck-claim reclaim (`processing` older than 10 min → `confirmed`) are both
   timestamp-conditional CAS updates — a live claim or a concurrent transition is never
   clobbered.
7. Rate limits: request 5/300s/IP, confirm 5/300s/IP, recover-account 3/60s/IP. Forensic IP
   self-check (`INFRA_IP`) compares the client IP against infra ranges and alerts on drift.

## ✅ P0 fixed (2026-09-22) — drizzle update result shape

Both CAS sites used to read the update result as `{ affectedRows }`:

```ts
const result = await db.update(arecs).set({ status: 'processing' }).where(...);
const affected = (result as unknown as { affectedRows?: number }).affectedRows;  // WRONG
```

drizzle@0.45 mysql2 resolves to the mysql2 tuple `[ResultSetHeader, FieldPacket[]]`, so
`affected` was **always `undefined`**: confirm claimed the row (`processing`), then
returned 400 without rollback, and `requestAccountRecovery` was never reached —
step 2 had never worked against a real MySQL (unit tests mocked the wrong shape).

Fixed by `mysqlAffectedRows()` (`src/lib/db/affected-rows.ts`), which reads
`result[0]?.affectedRows` and distinguishes `0` (clean CAS miss → 400) from an
unreadable shape (→ rollback + 500, never a silent stuck row). The unit-test
mocks now use the real tuple contract, with regression tests pinning it.

## Other known issues (from the 2026-09-21 review)

Fixed 2026-09-22 (`fix/recovery-critical`):

- **Frontend swallowed broadcast failure** — fixed. A failed final broadcast
  now renders an explicit error panel (never the success state), offers a
  working retry (same page or via `verify` returning `record_status: 'closed'`
  → retry-broadcast mode that skips confirm), and reports the
  `recovery_account` analytics event with `status: 'broadcast_failed'`.
- Success page linked to `/login.html#…&msg=accountrecovered` — fixed: real
  `/login?account=…&msg=accountrecovered`, and the login form renders an
  "account recovered" notice for that `msg` value.
- `verify/[code]` returned "has not been approved yet" for
  closed/consumed/processing alike — fixed with state-accurate responses
  (`record_status` machine-readable field).

Still open:

- Schema ↔ `drizzle/0000_*.sql` are internally consistent, but differ from the legacy authority
  in three recorded ways (`uid` width, missing `user_id` index, extra `memo_key` column) — if the
  production DB was built by legacy migrations, `drizzle-kit push` will produce unexpected diffs.
  The drift is now documented in `docs/DATABASE.md` ("Differences from legacy schema");
  aligning the schema/migration remains a production-data decision.

Fixed 2026-09-22 (`fix/recovery-hardening`):

- **Code TTL (24h) + stuck-`processing` self-heal (10 min)** — see
  `src/lib/recovery/lifecycle.ts`. The confirm claim CAS is TTL-bounded;
  verify/confirm lazily transition stale `confirmed`/`processing` records to
  the terminal `expired` status (wallet-legacy had no expiry — the 24h value
  is our choice, documented in the module header) and CAS-reclaim crashed
  `processing` claims back to `confirmed` so one dead request cannot brick a
  recovery. Both transitions read affected rows via `mysqlAffectedRows`.
  Deliberately NOT added: a failed-attempt counter on confirm — legacy has
  none, the code is 80 bits of entropy, confirm already requires the
  old-owner-key match, and the IP rate limit (5/300s) bounds guessing.
- **Frontend owner-history proof now checks the FULL key set**
  (`src/lib/steem/owner-history.ts`, used by both recovery pages) — same
  semantics as the server; multi-key owner accounts are no longer wrongly
  rejected in the UI. (Login's first-key-only comparison is a separate
  known limitation, unchanged here.)
- **New-password validation**: ≥ 32 characters (the wallet-legacy
  `PasswordInput.jsx` rule), enforced live and pre-derivation on the
  confirmation page (`newPasswordError` is now a real state).
- **`contact_email` length cap** (≤ 256, the column width) → clean 400
  instead of a strict-mode MySQL 500.
- **`INFRA_IP` self-check covers IPv4-mapped IPv6** (`::ffff:a.b.c.d` —
  the embedded IPv4 is tested against the infra ranges) via
  `src/lib/middleware/infra-ip.ts`; still warn-only.

## How to work in this module

- Read `docs/ACCOUNT_RECOVERY.md` first (state machine + rationale), then the tests:
  `tests/unit/recovery-*-route.test.ts` encode the security decisions above (S3 tuples, F12
  ordering, rollback behavior, fail-closed). If a change makes one of these tests wrong, the
  change is probably wrong.
- `SteemService.requestAccountRecovery` → conveyor JSON-RPC → `kingdom.recovery_account`.
  Protocol changes require syncing both sides (see AGENTS.md registry) and re-running the
  recovery tests.
- Concurrency model (post-P0-fix): confirm races are settled by the `confirmed→processing` CAS
  (single winner); duplicate requests can create parallel `open` rows (admin adjudicates, same as
  legacy); consume is id+CAS'd.
- When touching `arecs` queries remember `getDb()` may be null (503) and the drizzle pool is a
  lazily-initialized singleton — unit tests must `vi.mock('@/lib/db')` (08-testing.md).
