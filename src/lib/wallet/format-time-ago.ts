/** Relative time label for blockchain history timestamps. */
export function formatTimeAgo(dateStr: string, locale?: string): string {
  const date = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(locale);
}

/** Relative label for future timestamps (e.g. next power down date). */
export function formatTimeUntil(dateStr: string, locale?: string): string {
  const date = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`);
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);

  if (seconds <= 0) return formatTimeAgo(dateStr, locale);
  if (seconds < 60) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `in ${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString(locale);
}
