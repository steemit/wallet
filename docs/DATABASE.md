# Database — Drizzle ORM + MySQL

This document describes the database layer built on Drizzle ORM with MySQL (MariaDB), replacing the legacy Sequelize-based backend.

## Architecture

```
Next.js Server → Drizzle ORM → mysql2 driver → MySQL (Docker / RDS)
```

| Layer | Component | Purpose |
|-------|-----------|---------|
| ORM | Drizzle ORM (`drizzle-orm`) | Type-safe query builder, schema definitions |
| Driver | mysql2 (`mysql2`) | MySQL protocol implementation, connection pooling |
| Database | MySQL 8 / MariaDB 11 | Persistent storage |
| Migration | drizzle-kit | Schema introspection, migration generation, push |

---

## Project Structure

```
src/lib/db/
├── index.ts          # Connection pool singleton (server-side)
└── schema/
    └── index.ts      # Drizzle schema definitions (table mappings)

drizzle/
├── 0000_*.sql        # Generated SQL migration files
└── meta/
    ├── _journal.json # Migration journal
    └── *.json        # Schema snapshots

drizzle.config.ts     # drizzle-kit configuration
```

---

## Connection Pool Singleton

**File:** `src/lib/db/index.ts`

Follows the same singleton pattern as `src/lib/cache/redis.ts`:

```typescript
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

let db: DrizzleDb | null = null;
let pool: mysql.Pool | null = null;
let dbUnavailable = false;

export function getDb() { /* lazy-init pool on first call */ }
export async function closeDb() { /* graceful shutdown */ }
export function resetDb() { /* test cleanup */ }
```

- **Lazy initialization**: pool is created on the first `getDb()` call
- **Graceful degradation**: returns `null` if `DATABASE_URL` is not set or connection fails
- **Connection limit**: 5 connections (adjust for production based on instance count)
- **Environment variable**: `DATABASE_URL` (e.g. `mysql://user:pass@host/db`)

---

## Schema Definitions

**File:** `src/lib/db/schema/index.ts`

Tables are defined using Drizzle's MySQL column types. Each table maps to a legacy wallet-legacy table:

```typescript
import { mysqlTable, int, varchar, text, datetime, index } from 'drizzle-orm/mysql-core';

export const arecs = mysqlTable(
  'arecs',
  {
    id: int('id').autoincrement().primaryKey(),
    contactEmail: varchar('contact_email', { length: 256 }).notNull(),
    accountName: varchar('account_name', { length: 64 }).notNull(),
    status: varchar('status', { length: 32 }).default('open'),
    // ... more columns
  },
  (table) => ({
    idxAccountName: index('idx_arecs_account_name').on(table.accountName),
  })
);
```

**Naming convention:**
- JS/TS property: camelCase (`contactEmail`)
- DB column: snake_case (`contact_email`)
- Index prefix: `idx_<table>_<column>` (`idx_arecs_account_name`)

---

## Local Development

### Prerequisites

- MySQL / MariaDB running on `127.0.0.1:3306` (Docker recommended)
- `DATABASE_URL` set in `.env.local`:
  ```
  DATABASE_URL=mysql://root:12345678@127.0.0.1/wallet_dev
  ```

### Initial Setup

```bash
# Create database and apply migrations
DATABASE_URL='mysql://root:12345678@127.0.0.1/wallet_dev' pnpm exec drizzle-kit push

# Verify
mysql -u root -p12345678 -h 127.0.0.1 wallet_dev -e "SHOW TABLES;"
```

### Adding a New Table

1. Add table definition to `src/lib/db/schema/index.ts`
2. Generate migration:
   ```bash
   DATABASE_URL='mysql://root:12345678@127.0.0.1/wallet_dev' pnpm exec drizzle-kit generate
   ```
3. Apply migration:
   ```bash
   DATABASE_URL='mysql://root:12345678@127.0.0.1/wallet_dev' pnpm exec drizzle-kit push
   ```
4. Verify:
   ```bash
   mysql -u root -p12345678 -h 127.0.0.1 wallet_dev -e "DESCRIBE <table_name>;"
   ```

### Syncing Schema from Database

```bash
# Pull current database schema and show diff
DATABASE_URL='mysql://root:12345678@127.0.0.1/wallet_dev' pnpm exec drizzle-kit diff

# Push local schema changes to database (destructive!)
DATABASE_URL='mysql://root:12345678@127.0.0.1/wallet_dev' pnpm exec drizzle-kit push
```

---

## Legacy Schema Mapping

Tables ported from wallet-legacy:

| Legacy Table | Legacy Model | Drizzle Schema | Status |
|--------------|--------------|----------------|--------|
| `arecs` | `AccountRecoveryRequest` | `src/lib/db/schema/index.ts` | ✅ Migrated (with known drift, see below) |
| `users` | `User` | — | ⏳ Pending |
| `accounts` | `Account` | — | ⏳ Pending |
| `identities` | `Identity` | — | ⏳ Pending |

Schema sources:
- `~/workspace/wallet-legacy/src/db/migrations/` (Sequelize migrations)
- `~/workspace/wallet-legacy/src/db/models/` (Sequelize model definitions)

### Differences from legacy schema (`arecs`)

The drizzle schema and `drizzle/0000_polite_warhawk.sql` are internally
consistent, but they differ from the legacy authority
(`wallet-legacy/src/db/migrations/20160715233035-account-recovery-request.js`)
in three recorded ways:

1. **`uid` width**: drizzle declares `varchar(64)`; the legacy migration
   created `STRING(32)`. If production tables were built by legacy
   migrations, the column is 32 chars wide there.
2. **`user_id` index**: the legacy migration creates an index on `user_id`
   (`addIndex('arecs', ['user_id'])`); the drizzle migration does not
   (it indexes `uid`, `account_name`, `contact_email`, `validation_code`).
3. **`memo_key` column**: the drizzle migration includes `memo_key`
   (`text NULL`); the legacy migration does not create it.

Operational implication: if the production database reuses tables built by
the legacy Sequelize migrations, running `drizzle-kit push` against it will
produce unexpected diffs (column width change, index drop/add, column add)
beyond whatever change was intended. **Verify the live production schema
(`SHOW CREATE TABLE arecs`) and decide each diff explicitly before any
push** — aligning the schema or migration is a production-data decision and
is deliberately not done in code. The same verification applies to
`contact_email`: drizzle and the new migration declare `varchar(256)`, which
matches the legacy migration's `STRING(256)`.

---

## Query Examples

### Using Drizzle ORM (recommended)

```typescript
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { arecs } from '@/lib/db/schema';

const db = getDb();
if (!db) throw new Error('DB unavailable');

// Find first match
const existing = await db.query.arecs.findFirst({
  where: and(
    eq(arecs.accountName, 'alice'),
    eq(arecs.contactEmail, 'alice@example.com'),
    eq(arecs.status, 'open')
  ),
});

// Insert
await db.insert(arecs).values({
  contactEmail: 'alice@example.com',
  accountName: 'alice',
  ownerKey: 'STM6xxx',
  status: 'open',
});

// Update
await db.update(arecs)
  .set({ status: 'confirmed' })
  .where(eq(arecs.id, 1));
```

### Raw SQL (when needed)

```typescript
import { sql } from 'drizzle-orm';
const db = getDb()!;

const [rows] = await db.execute(
  sql`SELECT id, account_name FROM arecs WHERE status = 'open'`
);
```

---

## Testing

The DB module is a singleton, so tests mock `@/lib/db`:

```typescript
vi.mock('@/lib/db', () => ({
  getDb: () => mockDb,
}));

const mockDb = {
  query: {
    arecs: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnValue({ values: vi.fn() }),
};
```

For integration tests, use `resetDb()` to clear the singleton state between tests.

---

## Production Considerations

### Connection Pool Sizing

Default: 5 connections. For production:
- 1 connection per concurrent request + buffer
- Ensure MySQL `max_connections` exceeds total pool size across all instances
- Monitor with `SHOW PROCESSLIST`

### SSL/TLS

For AWS RDS, add SSL options to the connection pool:

```typescript
pool = mysql.createPool({
  uri: url,
  ssl: { rejectUnauthorized: true },
  // ...
});
```

### Health Check

Check database connectivity via `getDb()` — returns `null` if unavailable:

```typescript
const health = getDb() ? 'connected' : 'disconnected';
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes (for DB features) | MySQL connection URI (`mysql://user:pass@host/db`) |

Example `.env.local`:
```
DATABASE_URL=mysql://root:12345678@127.0.0.1/wallet_dev
```

---

## Migration History

| Date | Commit | Change |
|------|--------|--------|
| 2026-05-28 | 696039a7 | Initial Drizzle ORM integration, `arecs` table |
