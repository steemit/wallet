/**
 * Read `affectedRows` from a drizzle-orm mysql2 update/insert/delete result.
 *
 * Real contract (drizzle-orm 0.45.x, mysql2 driver): an update without
 * `.returning()` goes through `MySql2PreparedQuery.execute()`, which resolves
 * to the RAW mysql2 query result — the tuple `[ResultSetHeader, FieldPacket[]]`.
 * The ResultSetHeader (with `affectedRows`) lives at index 0, NOT on the
 * tuple itself.
 *
 * History: the recovery CAS sites used to read
 * `(result as { affectedRows }).affectedRows`, which is always `undefined`
 * against the real driver — the CAS checks silently never matched, so
 * recovery step 2 has never worked on a real MySQL (unit tests mocked the
 * wrong shape and masked it; see docs/AI-driver/05-recovery.md).
 *
 * Returns `undefined` when the shape is not the expected tuple, so callers
 * can distinguish "0 rows matched" (a clean CAS miss) from "unreadable
 * result" (a contract drift that must be treated as an error, not as a miss).
 */
export function mysqlAffectedRows(result: unknown): number | undefined {
  if (!Array.isArray(result)) return undefined;
  const header = result[0] as { affectedRows?: unknown } | undefined;
  return typeof header?.affectedRows === 'number' ? header.affectedRows : undefined;
}
