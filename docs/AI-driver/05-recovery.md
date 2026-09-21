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
7. Rate limits: request 5/300s/IP, confirm 5/300s/IP, recover-account 3/60s/IP. Forensic IP
   self-check (`INFRA_IP`) compares the client IP against infra ranges and alerts on drift.

## ⚠️ P0 known bug (as of 2026-09-21) — drizzle update result shape

Both CAS sites read the update result as `{ affectedRows }`:

```ts
const result = await db.update(arecs).set({ status: 'processing' }).where(...);
const affected = (result as unknown as { affectedRows?: number }).affectedRows;  // WRONG
```

drizzle@0.45 mysql2 resolves to the mysql2 tuple `[ResultSetHeader, FieldPacket[]]`, so
`affected` is **always `undefined`**. Consequences: confirm claims the row (`processing`), then
returns 400, never rolls back (the `claimed` flag is set after the check), and the row is
permanently stuck (`verify` says "not approved", re-confirm CAS-matches 0 rows).
`requestAccountRecovery` is never reached — **step 2 has never worked against a real MySQL**.

Fix: `result[0]?.affectedRows` (both confirm/route.ts:127 and recover-account/route.ts:213), then
re-run the whole flow against a real MySQL — the unit tests mock the update as resolving
`{affectedRows:1}`, which is why CI stayed green (see 08-testing.md, mock-contract discipline).

## Other known issues (from the 2026-09-21 review)

- **Frontend swallows broadcast failure** (`recover-account-confirmation-page.tsx:118-131`):
  non-production-only `console.warn`, then `setSuccess(true)` + `recovery_account` analytics event.
  There is no retry path: the form always re-runs confirm, which CAS-rejects `closed` rows, so the
  tx can never be re-broadcast; rows linger in `closed` (never `consumed`).
- Success page links to `/login.html#…&msg=accountrecovered` — **does not exist** in this app
  (login is `/login`; `msg` handling only knows `passwordupdated`). Legacy leftover → 404.
- Frontend owner-history proof only checks `key_auths[0][0]` while the server checks the full key
  set — multi-key owners are wrongly rejected in the UI.
- `newPasswordError` state is never set: zero password strength/length validation before key
  derivation. Legacy enforced strength.
- `verify/[code]` returns "has not been approved yet" for closed/consumed/processing alike —
  misleading copy for used/stuck codes.
- No `expired` enforcement, no failure-count cap on code attempts (rate limit only), no
  un-sticking path for crashed `processing` rows.
- `contact_email` has no length bound vs `varchar(256)` — strict-mode MySQL turns >256 into 500.
- Schema ↔ `drizzle/0000_*.sql` are internally consistent, but differ from the legacy authority
  in three recorded ways (`uid` width, missing `user_id` index, extra `memo_key` column) — if the
  production DB was built by legacy migrations, `drizzle-kit push` will produce unexpected diffs.
  `docs/DATABASE.md` marks this migration "✅" without noting them.
- `INFRA_IP` regex misses IPv4-mapped IPv6 (`::ffff:10.0.0.1`) — alerting gap only.

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
