/** Parse "12.345 STEEM" / "$1.234 SBD" style asset strings to a numeric amount. */
export function parseAssetAmount(assetStr: string | undefined): number {
  if (!assetStr) return 0;
  const m = assetStr.match(/^([\d.]+)/);
  return m && m[1] ? parseFloat(m[1]) : 0;
}
