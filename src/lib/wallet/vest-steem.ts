import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

export const STEEM_POWER_TICKER = 'SP';

/** Convert VEST amount to equivalent STEEM (Steem Power) using chain globals. */
export function steemPowerFromVests(vests: number, globalProps: GlobalPropsData): number {
  const totalVests = parseAssetAmount(globalProps.total_vesting_shares);
  const totalVestSteem = parseAssetAmount(globalProps.total_vesting_fund_steem);
  if (totalVests <= 0) return 0;
  return totalVestSteem * (vests / totalVests);
}

/** Convert STEEM (Steem Power) amount to equivalent VESTS using chain globals. */
export function vestsFromSteemPower(steemPower: number, globalProps: GlobalPropsData): number {
  const totalVests = parseAssetAmount(globalProps.total_vesting_shares);
  const totalVestSteem = parseAssetAmount(globalProps.total_vesting_fund_steem);
  if (totalVestSteem <= 0) return 0;
  return totalVests * (steemPower / totalVestSteem);
}

/** Format a VEST amount as a chain asset string for signing/broadcast. */
export function formatVestsAsset(vests: number): string {
  return `${vests.toFixed(6)} VESTS`;
}

/** Convert a Steem Power user input to a VESTS asset string for chain ops. */
export function steemPowerToVestsAsset(steemPower: number, globalProps: GlobalPropsData): string {
  return formatVestsAsset(vestsFromSteemPower(steemPower, globalProps));
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

/**
 * Net delegated STEEM POWER: delegated out minus received. Ports legacy
 * `delegatedSteem` (wallet-legacy src/app/utils/StateFunctions.js:63-78,
 * `vests = delegated_vests - received_vests`). Positive = net delegated out,
 * negative = net received from other accounts.
 */
export function netDelegatedSteemPower(
  balance: Pick<WalletBalanceData, 'delegated_vesting_shares' | 'received_vesting_shares'>,
  globalProps: GlobalPropsData
): number {
  const delegatedVests = parseAssetAmount(balance.delegated_vesting_shares);
  const receivedVests = parseAssetAmount(balance.received_vesting_shares);
  return steemPowerFromVests(delegatedVests - receivedVests, globalProps);
}

/**
 * Signed display string for the delegation indicator, legacy sign convention
 * (wallet-legacy src/app/components/modules/UserWallet.jsx:659-661:
 * `(delegated_steem < 0 ? '+' : '') + (-delegated_steem).toFixed(3)`):
 * net received renders "+X", net delegated out renders "-X".
 */
export function formatDelegatedSteemPowerDisplay(netDelegated: number): string {
  const sign = netDelegated < 0 ? '+' : '';
  return sign + formatSteemPowerDisplay(-netDelegated);
}
