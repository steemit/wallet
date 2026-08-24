import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';

/**
 * STEEM POWER APR estimate, ported from wallet-legacy
 * `UserWallet.getCurrentApr`. Returns a percentage number (e.g. 2.5), or null
 * when the required global properties are unavailable.
 *
 * The inflation rate was 9.5% at block 7m and decreases 0.01% every 250k
 * blocks, floored at 0.95%.
 */
export function getCurrentSteemPowerApr(gprops: GlobalPropsData): number | null {
  const headBlock = gprops.head_block_number;
  const vestingRewardPercentRaw = gprops.vesting_reward_percent;
  if (
    headBlock === undefined ||
    vestingRewardPercentRaw === undefined ||
    gprops.virtual_supply === undefined
  ) {
    return null;
  }

  const initialInflationRate = 9.5;
  const initialBlock = 7000000;
  const decreaseRate = 250000;
  const decreasePercentPerIncrement = 0.01;

  const deltaBlocks = headBlock - initialBlock;
  const decreaseIncrements = deltaBlocks / decreaseRate;

  let currentInflationRate =
    initialInflationRate - decreaseIncrements * decreasePercentPerIncrement;
  if (currentInflationRate < 0.95) {
    currentInflationRate = 0.95;
  }

  const vestingRewardPercent = vestingRewardPercentRaw / 10000;
  const virtualSupply = parseAssetAmount(gprops.virtual_supply);
  const totalVestingFunds = parseAssetAmount(gprops.total_vesting_fund_steem);
  if (totalVestingFunds <= 0) return null;

  return (virtualSupply * currentInflationRate * vestingRewardPercent) / totalVestingFunds;
}
