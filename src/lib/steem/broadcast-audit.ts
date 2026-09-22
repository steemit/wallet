/**
 * Uniform audit logging for the broadcast relay routes.
 *
 * Every broadcast route used to log ONLY failures, with inconsistent wording
 * ("Broadcast transfer error:", "Broadcast power down error:", "Broadcast
 * cancel_transfer_from_savings error:", ...) — impossible to aggregate across
 * routes by grep, and successes left no audit trail at all. These helpers give
 * all relay routes one success and one failure pattern:
 *
 *   Broadcast succeeded: op=<op_type> route=<route> account=<name> tx_id=<tx> block=<n>
 *   Broadcast failed: route=<route> <error>
 *
 * Only public chain data is logged: the operation type, the route name, the
 * account name, and the chain-assigned transaction id/block. NEVER log
 * operation payloads, memos, signatures, or anything key-shaped.
 *
 * Every interpolated string is sanitized (whitespace stripped, length capped)
 * so a crafted request-body field cannot forge extra log lines.
 */
import type { BroadcastResult, SignedTransaction } from './types';

const MAX_LOG_VALUE_LENGTH = 64;

/**
 * Strip all whitespace (account names and op types contain none) and cap the
 * length so body-supplied strings cannot inject fake log lines. Values are
 * String()-coerced first: broadcast routes only truthiness-check the body's
 * username (the `as` cast is compile-time only), and a non-string must never
 * throw here and turn an already-broadcast transaction into a 500.
 */
function sanitizeLogValue(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return 'unknown';
  const cleaned = String(value).replace(/\s+/g, '');
  if (!cleaned) return 'unknown';
  return cleaned.length > MAX_LOG_VALUE_LENGTH
    ? cleaned.slice(0, MAX_LOG_VALUE_LENGTH)
    : cleaned;
}

/** First operation's type string (e.g. "transfer"), or 'unknown'. */
export function broadcastOpType(signedTx: SignedTransaction): string {
  const op0 = signedTx?.operations?.[0];
  return op0 ? op0[0] : 'unknown';
}

/**
 * Success audit line for a broadcast relay route. Call it right after
 * `SteemService.broadcastTransaction` resolves.
 */
export function logBroadcastSuccess(
  route: string,
  signedTx: SignedTransaction,
  username: string | number | undefined,
  result: BroadcastResult
): void {
  console.info(
    `Broadcast succeeded: op=${sanitizeLogValue(broadcastOpType(signedTx))}` +
      ` route=${sanitizeLogValue(route)}` +
      ` account=${sanitizeLogValue(username)}` +
      ` tx_id=${sanitizeLogValue(result?.id)}` +
      ` block=${result?.block_num ?? '?'}`
  );
}

/** Failure audit line for a broadcast relay route (route + error object). */
export function logBroadcastFailure(route: string, error: unknown): void {
  console.error(`Broadcast failed: route=${sanitizeLogValue(route)}`, error);
}
