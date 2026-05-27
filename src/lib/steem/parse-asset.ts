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
