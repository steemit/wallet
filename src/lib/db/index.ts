// Drizzle ORM database connection singleton
// Mirrors the pattern in src/lib/cache/redis.ts

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

import { MySql2Database } from 'drizzle-orm/mysql2';

type DrizzleDb = MySql2Database<typeof schema> & { $client: mysql.Pool };

let db: DrizzleDb | null = null;
let pool: mysql.Pool | null = null;
let dbUnavailable = false;

export function getDb() {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    if (!dbUnavailable) {
      dbUnavailable = true;
      console.warn('DATABASE_URL not set; database features disabled');
    }
    return null;
  }

  try {
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
    });

    db = drizzle(pool, { schema, mode: 'default' });
    // Reset flag on successful creation (allows recovery after transient failures)
    dbUnavailable = false;
    return db;
  } catch (err) {
    // Do NOT permanently mark as unavailable — next call may succeed
    console.error('Failed to create database connection:', err);
    return null;
  }
}

/** Close the pool (for tests / graceful shutdown) */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    dbUnavailable = false;
  }
}

/** Reset singleton state (for tests) */
export function resetDb(): void {
  db = null;
  pool = null;
  dbUnavailable = false;
}
