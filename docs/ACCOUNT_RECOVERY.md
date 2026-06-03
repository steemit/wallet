# Account Recovery

Complete account recovery flow for steemitwallet.com, spanning three services:
**wallet** (Next.js), **turtle** (Go admin backend), and **kingdom** (on-chain operation service via jussi).

---

## Overview

Account recovery allows a user whose owner key was compromised to regain control
of their account. It is a two-step process defined by the Steem blockchain:

1. **`request_account_recovery`** — Broadcast by the recovery account (e.g. @steem),
   sets a new owner authority on-chain.
2. **`recover_account`** — Broadcast by the user, signed with their old owner key,
   proves they owned the previous authority.

Between these two on-chain ops, the user must demonstrate ownership of the old key
and choose a new password. The entire flow ensures **private keys never leave the
user's browser**.

---

## Architecture

```
User Browser          Wallet (Next.js)         turtle            kingdom
    │                      │                     │                  │
    │  Step 1: Submit      │                     │                  │
    │  recovery request    │                     │                  │
    │─────────────────────>│                     │                  │
    │                      │  Insert arecs       │                  │
    │                      │  (status=open)      │                  │
    │                      │                     │                  │
    │                      │  turtle admin       │                  │
    │                      │  reviews &          │                  │
    │                      │  approves:          │                  │
    │                      │  status=confirmed,  │                  │
    │                      │  validation_code    │                  │
    │                      │  set, email sent    │                  │
    │                      │                     │                  │
    │  Step 2: Click       │                     │                  │
    │  email link          │                     │                  │
    │─────────────────────>│                     │                  │
    │                      │                     │                  │
    │  Verify code         │                     │                  │
    │─────────────────────>│                     │                  │
    │<─account_name────────│                     │                  │
    │                      │                     │                  │
    │  Submit old+new pwd  │                     │                  │
    │  (CSRF protected)    │                     │                  │
    │─────────────────────>│                     │                  │
    │                      │                     │                  │
    │                      │  kingdom.recovery_  │                  │
    │                      │  account (via jussi)│                  │
    │                      │─────────────────────────────────────────>│
    │                      │                     │   request_account │
    │                      │                     │   _recovery on-chain
    │                      │<─────────────────────────────────────────│
    │                      │                     │                  │
    │                      │  Update arecs       │                  │
    │                      │  status=closed      │                  │
    │                      │                     │                  │
    │<─────ok──────────────│                     │                  │
    │                      │                     │                  │
    │  Sign recover_account│                     │                  │
    │  locally (old key)   │                     │                  │
    │                      │                     │                  │
    │  Broadcast signed tx │                     │                  │
    │─────────────────────>│                     │                  │
    │                      │  Relay to           │                  │
    │                      │  steemd via         │                  │
    │                      │  condenser_api      │                  │
    │                      │  .broadcast_        │                  │
    │                      │  transaction        │                  │
    │<─────success─────────│                     │                  │
```

---

## Step 1: User submits recovery request

**Frontend:** `src/components/wallet/recover-account-step-1-page.tsx`
**API:** `POST /api/recovery/request`

1. User enters account name, recent owner password/key, and email.
2. Frontend derives the owner public key from the password **locally** and checks
   it against the on-chain owner history (`apiClient.getOwnerHistory`).
3. If the key matches a recent owner authority, the frontend submits the request
   to `POST /api/recovery/request` with CSRF protection.
4. Server inserts an `arecs` row with `status='open'`.

At this point the request waits for a turtle admin to approve it (set `status='confirmed'`
and generate a `validation_code`). The admin also sends a recovery email containing
a link like `https://steemitwallet.com/account_recovery_confirmation/{code}`.

---

## Step 2: User confirms recovery

**Frontend:** `src/components/wallet/recover-account-confirmation-page.tsx`
**Page route:** `/[locale]/account_recovery_confirmation/[code]`

### 2a. Verify code

**API:** `GET /api/recovery/verify/[code]`

- Looks up `arecs` by `validation_code`.
- Must be `status='confirmed'` (admin approved).
- Returns `account_name` to the frontend.

### 2b. Submit recovery

**API:** `POST /api/recovery/confirm` (CSRF protected)

1. Frontend validates the old password against on-chain owner history **locally**
   (key never leaves the browser).
2. Frontend sends `code`, `account_name`, `old_owner_key` (pub), `new_owner_key` (pub),
   and `new_owner_authority` to the server.
3. Server calls `SteemService.requestAccountRecovery()` which invokes
   `kingdom.recovery_account` via `steem.api.signedCallAsync`. This uses
   `CONVEYOR_USERNAME` / `CONVEYOR_POSTING_WIF` credentials to sign the JSON-RPC
   request. Kingdom then broadcasts `request_account_recovery` on-chain.
4. Server updates `arecs` → `status='closed'`, records `old_owner_key`, `new_owner_key`,
   `request_submitted_at`.

### 2c. Broadcast recover_account (client-side signing)

**API:** `POST /api/broadcast/recover-account`

1. Frontend calls `SteemSigner.signRecoverAccount(account, oldPassword, newPassword)`
   **locally**. This derives the old and new owner private keys from the passwords,
   constructs a `recover_account` operation, and signs it with the old owner key.
2. The signed transaction is sent to the server relay endpoint.
3. Server validates the transaction format (op must be `recover_account`) and
   broadcasts via `condenser_api.broadcast_transaction`.

---

## Database: `arecs` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT AUTO_INCREMENT PK | Row ID |
| `user_id` | INT NULL | Legacy user FK |
| `uid` | VARCHAR(64) NULL | Session UID |
| `contact_email` | VARCHAR(255) | User's email |
| `account_name` | VARCHAR(255) | Steem account name |
| `owner_key` | VARCHAR(255) | Current owner public key (submitted at step 1) |
| `old_owner_key` | TEXT NULL | Old owner public key (filled at step 2) |
| `new_owner_key` | TEXT NULL | New owner public key (filled at step 2) |
| `memo_key` | TEXT NULL | Memo key |
| `provider` | VARCHAR(32) | Auth provider (e.g. `email`) |
| `remote_ip` | VARCHAR(64) | Client IP |
| `status` | ENUM(open, confirmed, expired, closed) | Request lifecycle |
| `email_confirmation_code` | VARCHAR(255) NULL | Email verification code |
| `validation_code` | VARCHAR(255) NULL | 20-hex-char code in the recovery email link |
| `request_submitted_at` | DATETIME NULL | When step 2 was completed |
| `created_at` | DATETIME DEFAULT CURRENT_TIMESTAMP | Row creation time |
| `updated_at` | DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | Last update time |

### Status lifecycle

```
open → confirmed → processing → closed
              ↘ expired
```

- `open`: User submitted step 1, awaiting admin review.
- `confirmed`: Admin approved, `validation_code` generated, email sent.
- `processing`: User submitted step 2 confirm; server has claimed the record atomically (CAS). If `kingdom.recovery_account` fails, the record stays in `processing`. **Records stuck in `processing` for >1 hour should be manually reset to `confirmed` by ops** to allow retry.
- `expired`: Code expired (timeout, not currently enforced automatically).
- `closed`: User completed step 2, recovery done. The `validation_code` is now
  single-use (cannot be used again).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | MySQL connection URI for Drizzle ORM |
| `CONVEYOR_USERNAME` | Yes (prod) | Account name used to sign `kingdom.recovery_account` JSON-RPC call |
| `CONVEYOR_POSTING_WIF` | Yes (prod) | Posting WIF of the conveyor account |
| `STEEM_RPC_URL` | Yes | Steem RPC endpoint (jussi), routes `kingdom.*` namespace to kingdom service |

---

## API Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/api/recovery/request` | Submit step 1 recovery request | CSRF |
| GET | `/api/recovery/verify/[code]` | Validate code, return account name | None |
| POST | `/api/recovery/confirm` | Step 2: call kingdom + close arecs | CSRF |
| POST | `/api/broadcast/recover-account` | Relay signed `recover_account` tx | CSRF |

---

## Key Files

| File | Description |
|------|-------------|
| `src/app/api/recovery/request/route.ts` | Step 1 API |
| `src/app/api/recovery/verify/[code]/route.ts` | Code verification API |
| `src/app/api/recovery/confirm/route.ts` | Step 2 API (kingdom + DB update) |
| `src/app/api/broadcast/recover-account/route.ts` | Transaction relay |
| `src/components/wallet/recover-account-step-1-page.tsx` | Step 1 frontend |
| `src/components/wallet/recover-account-confirmation-page.tsx` | Step 2 frontend |
| `src/app/[locale]/account_recovery_confirmation/[code]/page.tsx` | Step 2 page route |
| `src/lib/steem/server.ts` | `SteemService.requestAccountRecovery()` |
| `src/lib/steem/client.ts` | `SteemSigner.signRecoverAccount()`, `apiClient.*` |
| `src/lib/db/schema/index.ts` | Drizzle schema for `arecs` |
| `drizzle/0000_polite_warhawk.sql` | Migration SQL |
| `tests/unit/recovery-request-route.test.ts` | Step 1 tests |
| `tests/unit/recovery-verify-route.test.ts` | Verify route tests |
| `tests/unit/recovery-confirm-route.test.ts` | Confirm route tests |

---

## Security Considerations

1. **Private keys never leave the browser.** All key derivation (`steem.auth.toWif`)
   and transaction signing (`SteemSigner.signTransaction`) happen client-side.
2. **CSRF protection** on all POST endpoints (`verifyCSRF` middleware).
3. **Rate limiting** on all recovery endpoints to prevent abuse.
4. **Code validation** — 20-hex-char format enforced server-side.
5. **Owner key format validation** — strict base58 regex `^STM[1-9A-HJ-NP-Za-km-z]{50}$` (excludes 0/O/I/l).
6. **Single-use codes** — `status` changes to `closed` after successful step 2,
   preventing replay.
7. **Account name verification** — Server checks that the account name from the
   arecs record matches the submitted one.
