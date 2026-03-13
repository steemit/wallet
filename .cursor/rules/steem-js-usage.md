## Steem JS Usage Rules

**Scope:** `wallet` project – all code that imports or uses `@steemit/steem-js`.

### 1. Import Style (ESM Only)

- Always use ESM imports. Never use `require` for steem-js.
- Preferred import form:

```ts
import { steem } from '@steemit/steem-js';
```

- Do **not** import from internal paths like `@steemit/steem-js/dist/...`.
  - Always import only from the package root.

### 2. What to Use from steem

- Use the high-level `steem` object exported by the library:

```ts
steem.api.getAccountsAsync(...)
steem.api.getAccountHistoryAsync(...)
steem.api.getDynamicGlobalPropertiesAsync(...)
steem.api.broadcastTransactionAsync(...)

steem.auth.isWif(...)
steem.auth.toWif(...)
steem.auth.wifToPublic(...)
steem.auth.signTransaction(...)
steem.auth.verifySignature(...)
```

- Do **not** construct your own API clients; always go through `steem.api` and `steem.auth`.

### 3. Node vs Browser Usage

- **Server-side code** (`src/lib/steem/server.ts`, API routes):
  - Import `steem` from `@steemit/steem-js` as described above.
  - Configure RPC endpoint via `steem.config.set({ nodes: [...] })` or `steem.api.setOptions({ url: ... })` in a single place (`ensureConfigured`).

- **Client-side code** (`src/lib/steem/client.ts` and anything under `use client`):
  - Same import style (`import { steem } ...`).
  - Only use `steem.auth` helpers and pure functions on the client.
  - Never make direct RPC calls from the client; all blockchain IO must go through Next.js API routes.

### 4. Key Handling Rules

- All key derivation and validation must use steem-js:

```ts
steem.auth.isWif(...)
steem.auth.toWif(username, password, role)
steem.auth.wifToPublic(wif)
steem.auth.signTransaction(trx, [wif])
steem.auth.verifySignature(message, signature, publicKey)
```

- Master password:
  - Treat master password as input to `toWif(username, password, role)`.
  - Never store master password anywhere (Redux, localStorage, server).
  - Only store derived role keys (`owner`, `active`, `posting`, `memo`) in memory (Redux in-memory state only).

### 5. Redux Auth State Convention

- `AuthState` must keep per-role keys, never master password:
  - `ownerKey: string | null`
  - `activeKey: string | null`
  - `postingKey: string | null`
  - `memoKey: string | null`
  - `privateKey` is a **derived primary key** (typically `activeKey`), kept only for backwards compatibility.
- Any new code that needs a signing key for wallet operations should:
  - Prefer `activeKey`.
  - Fall back to `privateKey` only when necessary for backwards compatibility.

### 6. API Layer Responsibilities

- All direct RPC calls to Steem nodes must live in `src/lib/steem/server.ts` via `steem.api`.
- Next.js API routes must:
  - Call `SteemService` methods only.
  - Never touch `steem` directly.
- Client-side code must:
  - Use `SteemSigner` + `apiClient` (both steem-js-based) for signing and calling API routes.

### 7. No Mixed Module Systems

- No `require` or CommonJS anywhere in this project for steem-js.
- If you need to adapt types or behavior, do it via:
  - Type-only imports from `@steemit/steem-js`’s public types.
  - Thin wrapper functions in `src/lib/steem/*`.

