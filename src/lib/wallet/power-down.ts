import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import { steemPowerFromVests, vestsFromSteemPower } from '@/lib/wallet/vest-steem';

const MICRO_VEST_SCALE = 1_000_000;

/** Chain `to_withdraw` / `withdrawn` fields are stored in micro-VESTS (legacy /1e6). */
export function microVestsToVests(micro: number): number {
  return micro / MICRO_VEST_SCALE;
}

export interface PowerDownAccountFields {
  vesting_shares: string;
  delegated_vesting_shares: string;
  to_withdraw: number;
  withdrawn: number;
}

/** Max VESTS that can be selected on the power down slider. */
export function getPowerDownMaxVests(account: PowerDownAccountFields): number {
  const vesting = parseAssetAmount(account.vesting_shares);
  const delegated = parseAssetAmount(account.delegated_vesting_shares);
  return Math.max(0, vesting - delegated);
}

export function getPowerDownToWithdrawVests(account: PowerDownAccountFields): number {
  return microVestsToVests(account.to_withdraw);
}

export function getPowerDownWithdrawnVests(account: PowerDownAccountFields): number {
  return microVestsToVests(account.withdrawn);
}

/** Default slider position (matches wallet-legacy Powerdown constructor). */
export function getDefaultPowerDownVests(
  account: PowerDownAccountFields,
  globalProps: GlobalPropsData
): number {
  const toWithdraw = getPowerDownToWithdrawVests(account);
  const withdrawn = getPowerDownWithdrawnVests(account);
  if (toWithdraw - withdrawn > 0) {
    return toWithdraw - withdrawn;
  }
  const max = getPowerDownMaxVests(account);
  const reserve = vestsFromSteemPower(5.001, globalProps);
  return Math.max(0, max - reserve);
}

export function clampPowerDownVests(withdrawVests: number, maxVests: number): number {
  return Math.min(Math.max(0, withdrawVests), maxVests);
}

/** Weekly STEEM payout estimate (legacy: total / 4 payments per month). */
export function formatPowerDownWeeklySteem(
  withdrawVests: number,
  globalProps: GlobalPropsData
): string {
  const weekly = steemPowerFromVests(withdrawVests, globalProps) / 4;
  return weekly.toFixed(weekly >= 10 ? 0 : 1);
}

export function isPowerDownReserveWarning(
  withdrawVests: number,
  maxVests: number,
  globalProps: GlobalPropsData
): boolean {
  const reserve = vestsFromSteemPower(5, globalProps);
  return withdrawVests > maxVests - reserve;
}
