/** Chain asset as `"1.234 SBD"` or `{ amount, precision, nai }` from database_api. */
export function parseSteemAsset(asset: unknown): number {
  if (asset == null) return 0;
  if (typeof asset === 'number') return Number.isFinite(asset) ? asset : 0;
  if (typeof asset === 'string') {
    const n = parseFloat(asset.trim().split(/\s+/)[0] ?? '0');
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof asset === 'object') {
    const { amount, precision } = asset as { amount?: string | number; precision?: number };
    if (amount == null) return 0;
    const raw = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (!Number.isFinite(raw)) return 0;
    const prec = typeof precision === 'number' && precision >= 0 ? precision : 0;
    return raw / 10 ** prec;
  }
  return 0;
}

/**
 * Normalize a chain asset to the legacy string form (`"5971.304284 VESTS"`)
 * that condenser_api returns. database_api instead returns NAI objects
 * (`{ amount, precision, nai }`) where `amount` is integer units in the
 * asset's precision — plain number math loses exactness beyond
 * Number.MAX_SAFE_INTEGER (total vesting shares exceed it), so the
 * conversion is done by decimal-string slicing. Legacy-form strings pass
 * through unchanged; malformed input degrades to `"0 <symbol>"`.
 */
export function formatSteemAssetString(asset: unknown, symbol: string): string {
  if (typeof asset === 'string') return asset;
  if (asset == null || typeof asset !== 'object') return `0 ${symbol}`;
  const { amount, precision } = asset as { amount?: string | number; precision?: number };
  const prec =
    typeof precision === 'number' && Number.isInteger(precision) && precision >= 0
      ? precision
      : 0;
  const digits =
    typeof amount === 'number'
      ? String(Math.trunc(Math.abs(amount)))
      : typeof amount === 'string' && /^\d+$/.test(amount.trim())
        ? amount.trim()
        : '';
  if (!digits) return `0 ${symbol}`;
  const padded = digits.padStart(prec + 1, '0');
  const whole = padded.slice(0, padded.length - prec);
  const frac = padded.slice(padded.length - prec);
  const body = prec > 0 ? `${whole}.${frac}` : whole;
  return `${body} ${symbol}`;
}
