import { parseSteemAsset } from '@/lib/steem/parse-asset';

/**
 * Parse "12.345 STEEM" / "$1.234 SBD" style asset strings to a numeric amount.
 * Also tolerates NAI asset objects (`{ amount, precision, nai }`) so a
 * database_api-shaped payload cannot crash the render path.
 */
export function parseAssetAmount(asset: unknown): number {
  if (typeof asset === 'object' && asset !== null) {
    return parseSteemAsset(asset);
  }
  if (!asset) return 0;
  const m = String(asset).match(/^([\d.]+)/);
  return m && m[1] ? parseFloat(m[1]) : 0;
}
