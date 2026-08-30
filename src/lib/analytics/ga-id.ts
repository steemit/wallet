/**
 * Google Analytics measurement ID helpers.
 *
 * Legacy injected gtag from `google_analytics_id` / `SDC_GOOGLE_ANALYTICS_ID`
 * at render time (not a build-time public env). Read the ID on the server so
 * production can change it without rebuilding the Next.js client bundle.
 */

const GA_ID_RE = /^(G|GT|AW)-[A-Z0-9]+$|^UA-\d+-\d+$/i;

export function isValidGaMeasurementId(id: string): boolean {
  return GA_ID_RE.test(id.trim());
}

/**
 * Resolve the configured GA measurement ID, or null if unset/invalid.
 * Checked in order: GOOGLE_ANALYTICS_ID, SDC_GOOGLE_ANALYTICS_ID (legacy ops),
 * NEXT_PUBLIC_GOOGLE_ANALYTICS_ID (build-time fallback).
 */
export function getGaMeasurementId(): string | null {
  const candidates = [
    process.env.GOOGLE_ANALYTICS_ID,
    process.env.SDC_GOOGLE_ANALYTICS_ID,
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (id && isValidGaMeasurementId(id)) return id;
  }
  return null;
}
