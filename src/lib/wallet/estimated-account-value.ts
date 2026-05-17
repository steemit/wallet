import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

export interface WalletEstimateExtras {
  savingsPendingSteem?: number;
  savingsPendingSbd?: number;
  conversionTotalSbd?: number;
  steemOrders?: number;
  sbdOrders?: number;
}

export interface WalletPrices {
  steemPrice: number;
  sbdPrice: number;
}

function vestingSteemFromVests(vests: number, globalProps: GlobalPropsData): number {
  const totalVests = parseAssetAmount(globalProps.total_vesting_shares);
  const totalVestSteem = parseAssetAmount(globalProps.total_vesting_fund_steem);
  if (totalVests <= 0) return 0;
  return totalVestSteem * (vests / totalVests);
}

export function computeEstimatedAccountValueUsd(
  balance: WalletBalanceData,
  globalProps: GlobalPropsData,
  prices: WalletPrices,
  extras: WalletEstimateExtras = {}
): number | null {
  const vestingShares = parseAssetAmount(balance.vesting_shares);
  const vestingSteem = vestingSteemFromVests(vestingShares, globalProps);

  const totalSteem =
    vestingSteem +
    parseAssetAmount(balance.balance) +
    parseAssetAmount(balance.savings_balance) +
    (extras.savingsPendingSteem ?? 0) +
    (extras.steemOrders ?? 0);

  const totalSbd =
    parseAssetAmount(balance.sbd_balance) +
    parseAssetAmount(balance.savings_sbd_balance) +
    (extras.savingsPendingSbd ?? 0) +
    (extras.sbdOrders ?? 0) +
    (extras.conversionTotalSbd ?? 0);

  const { steemPrice, sbdPrice } = prices;

  if (steemPrice > 0 && sbdPrice > 0) {
    return totalSteem * steemPrice + totalSbd * sbdPrice;
  }
  if (steemPrice > 0) {
    return totalSteem * steemPrice + totalSbd;
  }
  return null;
}

export function formatEstimatedAccountValueUsd(valueUsd: number | null): string {
  if (valueUsd === null || !Number.isFinite(valueUsd)) {
    return '---';
  }
  const formatted = valueUsd.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${formatted}`;
}
