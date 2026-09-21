# 06 — Frontend: state, data flow, and client-side signing

## The real architecture (as opposed to the nominal one)

- **Redux** (`src/lib/store/`): only the `auth` slice is live (credentials, keys — sanitized in
  DevTools). The `wallet` and `ui` slices have **zero consumers** — do not dispatch into them;
  delete-on-sight candidates. Theming lives in `src/lib/theme.ts` (useSyncExternalStore +
  localStorage, three values original/light/dark), not in Redux.
- **The actual data layer is the hooks** (`src/hooks/` + four history hooks historically living in
  `src/lib/wallet/`), each owning local state around `cachedFetch`/`apiClient` calls.
- **The refresh signal** is the wallet nonce, paired with explicit L1
  invalidation: the broadcast success path (`page.tsx`
  `handleWalletDataChanged`) first calls `invalidateWalletCache(username)`
  (`lib/cache/client-invalidate.ts`) — dropping the exact URL-keyed L1 entries
  the hooks cached — and then bumps the nonce so subscribed hooks refetch.
  The ordering is load-bearing: `cachedFetch` serves its fresh window without
  any request and its background refresh rewrites the LRU without notifying
  anyone, so a nonce bump WITHOUT the invalidation keeps rendering
  pre-broadcast balances (this shipped and was fixed in 2026-09). When you
  add a broadcast success handler in a new component, call
  `invalidateWalletCache` for the acting user before any refetch.

## Data-fetching rules for new code

1. **Race guarding is mandatory**: keep a `requestId`/`cancelled` flag and drop responses that
   aren't from the latest request. Roughly half the existing hooks have it
   (`use-delegations`, `use-batch-history`, `use-wallet-estimated-value`) and half don't
   (`use-account-data`, `use-steem-account`, `use-steem-wallet-balances`, `use-proposals`,
   `use-market-data.refresh`). Copy the guarded style.
2. **Reset state when the identity input changes** (username, filter): clear old data (or mark
   loading) before the first new response lands, or users briefly see the previous account's
   numbers (`use-wallet-estimated-value` has this bug today).
3. **Error handling**: pick one shape per surface — `error` state rendered inline (forms), toast
   (page-level actions), or silent-with-sentinel (background metadata) — and never leave a
   broadcast call without a catch that the user can see. `market-page-client.placeOrder` is the
   counter-example (unhandled rejection, zero feedback).
4. **Polling**: `setInterval` must pause on `document.hidden` and clean up on unmount
   (`use-service-health` is the model; `use-market-data`'s 3s market poll currently doesn't).
   Budget: market polls every 3s per visible tab against a 120/min/IP route limit.
5. **One fetch site per endpoint family**: `/api/query/accounts` currently has 6 call sites with
   4 different cache configs, causing 3–4 fetches on one page and inconsistent freshness. Add a
   shared hook instead of an Nth call site.
6. `cachedFetch` options: `noStore:true` to bypass; do NOT fake it with `staleMs:0,maxAgeMs:0`
   (writes dead LRU entries). Remember stale-while-revalidate never notifies the consumer — plan
   for "this mount shows the stale value" or invalidate explicitly.

## Username normalization — the #1 source of UI bugs

Steem names are case-insensitive and users type `@Name`. Normalize **once, early** with
`normalizeSteemUsername` (lowercase + strip `@`) — then compare only normalized values.
The codebase currently mixes raw `===` (`[username]/page.tsx` `isMyAccount`,
`convert-sbd-form`, `withdraw-routes-form`), normalized helpers
(`sessionMatchesPage`, `canManageBalanceForPageUrl`), and partial normalizers, producing real
bugs: logged-in-as-`alice` on `/@Alice/transfers` gets action buttons that open forms whose
`canSubmit` is permanently false, activity rows mis-classified (deposit shows as transfer, order
side flipped), and duplicated `activity:Alice`/`activity:alice` caches. When touching any
username comparison, convert it to the normalized form — and remember chain op fields are always
canonical lowercase.

## Client-side signing (`src/lib/steem/client.ts`)

- `SteemSigner` holds ~20 `sign<Op>` static methods: build the op, `signTransaction` (fetches
  block ref/expiration via `/api/query/transaction-header`, normalizes account names, signs via
  steem-js). Private keys are function-local; never store them on the signer.
- The cached transaction header is fine for freshness: Steem txs carry hour-scale `expiration`,
  so a tens-of-seconds-cached `ref_block_*` still validates (headers rotate as blocks pass, and
  the route's TTL is short).
- `apiClient` (`client.ts:660+`) wraps all API calls; mutating ones read the CSRF cookie into
  `X-CSRF-Token`. When adding a method: encode query params (`encodeURIComponent`) — one existing
  method (`getAccounts`' comma-join) forgot — and return the parsed body so callers can check
  `success`.
- Amounts: parse with `lib/wallet/parse-asset-amount.ts` (there are two stray copies —
  `convert-sbd-form` local + `balance-rows` split/parseFloat — don't add a fourth). For integer
  comparisons prefer BigInt (`witness-vote-form` does). Validate decimals *before* rounding;
  reject `countDecimals > 3` rather than `toFixed(3)` after the balance check.
- Market order ids: `Math.floor(Date.now()/1000)` collides within the same second (second order
  replaces the first). Use a monotonic counter per session if you touch this.

## Legacy-parity watchlist (verified drifts from `wallet-legacy`)

These four are real semantic losses found in review; if you own the area, fix with a test:
1. Delegation display uses only `delegated_vesting_shares`; legacy = net of `received_vesting_shares`
   with the opposite sign — accounts that *receive* delegation show "not delegated" (false).
2. `validateMemoField` dropped `memo_is_password` (derive memo pubkey from
   `username+'memo'+value` and compare to `memo_key`) — the "you pasted your master password"
   warning is gone.
3. Open-order rows mix remaining (`for_sale`) with full (`sell_price.quote`) amounts — partially
   filled orders show self-inconsistent columns. Legacy used sell_price for both.
4. Claim-rewards banner button has no `onClick` (no `claim_reward_balance` path exists at all).

**Bonus trap — `use-batch-history` unmount cache write:** its cleanup effect (deps `[cacheKey]`)
captures the mount-time empty `history`, so the pagination cache is never written; worse, when
the username changes in-place (`/@a/transfers` → `/@b/transfers`), the cleanup writes **A's history
under B's cache key** — cross-user data display for up to 120s. If you touch it, restructure so
the cleanup reads a ref, and clear/reset state synchronously on identity change.

## Redux & storage safety

- Only `auth/setCredentials` may carry key material, and both DevTools sanitizers key off it
  (`store/index.ts`). A second key-carrying action silently escapes redaction.
- localStorage: `username` + optional posting key only (see 02-auth). All access currently
  routes through `browser-storage.ts` getters + the login form's writer — keep it that way.
- SSR/hydration: localStorage/document access only inside effects or event handlers; pages are
  dynamic behind the proxy.

## Component-level conventions

- Forms: validate on change into `error` state, gate `canSubmit`, and show *why* it's disabled
  when the cause is a session/permission mismatch (the normalized-username bug above produces
  silently-dead forms otherwise).
- i18n: `t('key', { defaultMessage })` — **always** provide `defaultMessage` (es.json is missing
  10 keys; two of them render raw keys today). Keep en/zh/es in sync; a key diff script is cheap.
- History/activity: op-type copy lives in `WALLET_OP_TYPES` + `recent-activity.tsx`; new op types
  need entries there, plus `normalize-history.ts` mapping.
- Wallet modals are opened via search params (`wallet-modal-search-params.ts`) — follow that
  pattern for new wallet actions instead of ad-hoc local state.
- Types: `wallet-balance-types.ts` lies about `to_withdraw/withdrawn` (says string, is number).
  Prefer `SteemAccount` (`lib/steem/types.ts`) for new code until it's cleaned up.
