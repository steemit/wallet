/**
 * Steem condenser / jussi time_point_sec strings in JSON broadcasts.
 * Use seconds precision, no timezone suffix (matches steem-js `toISOString().slice(0, 19)`).
 */
export function formatSteemIsoTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19);
}

export function unixSecToSteemIsoTimestamp(unixSec: number): string {
  return formatSteemIsoTimestamp(new Date(unixSec * 1000));
}
