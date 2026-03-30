import type { WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

export function hasPendingRewards(balance: WalletBalanceData | null): boolean {
  if (!balance) return false;
  return (
    parseFloat(balance.reward_steem_balance || '0') > 0 ||
    parseFloat(balance.reward_sbd_balance || '0') > 0 ||
    parseFloat(balance.reward_vesting_steem || '0') > 0
  );
}

export function buildRewardsDisplayStr(balance: WalletBalanceData): string {
  const rewards: string[] = [];
  const rewardSteem = balance.reward_steem_balance;
  const rewardSbd = balance.reward_sbd_balance;
  const rewardSp = balance.reward_vesting_steem;
  if (rewardSteem && parseFloat(rewardSteem.split(' ')[0] || '0') > 0) rewards.push(rewardSteem);
  if (rewardSbd && parseFloat(rewardSbd.split(' ')[0] || '0') > 0) rewards.push(rewardSbd);
  if (rewardSp && parseFloat(rewardSp.split(' ')[0] || '0') > 0) {
    rewards.push(rewardSp.replace('STEEM', 'SP'));
  }
  if (rewards.length === 3) {
    const [a, b, c] = rewards;
    return `${a}, ${b} and ${c}`;
  }
  if (rewards.length === 2) {
    const [a, b] = rewards;
    return `${a} and ${b}`;
  }
  if (rewards.length === 1) return rewards[0] ?? '';
  return '';
}
