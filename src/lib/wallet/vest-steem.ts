import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';

/** Convert VEST amount to equivalent STEEM (Steem Power) using chain globals. */
export function steemPowerFromVests(vests: number, globalProps: GlobalPropsData): number {
  const totalVests = parseAssetAmount(globalProps.total_vesting_shares);
  const totalVestSteem = parseAssetAmount(globalProps.total_vesting_fund_steem);
  if (totalVests <= 0) return 0;
  return totalVestSteem * (vests / totalVests);
}

/** Parse a VESTS asset string and return STEEM-power equivalent. */
export function steemPowerFromVestsString(
  vestAsset: string | undefined,
  globalProps: GlobalPropsData
): number {
  return steemPowerFromVests(parseAssetAmount(vestAsset), globalProps);
}

/** Format SP amount with thousands separators (legacy numberWithCommas + 3 decimals). */
export function formatSteemPowerDisplay(steemPower: number): string {
  return steemPower.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function formatSteemPowerFromVestsString(
  vestAsset: string | undefined,
  globalProps: GlobalPropsData
): string {
  return formatSteemPowerDisplay(steemPowerFromVestsString(vestAsset, globalProps));
}
