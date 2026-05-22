export const REWARD_OP_TYPES = [
  'author_reward',
  'curation_reward',
  'comment_benefactor_reward',
] as const;

export const WALLET_OP_TYPES = [
  'author_reward',
  'curation_reward',
  'comment_benefactor_reward',
  'transfer',
  'transfer_to_vesting',
  'transfer_to_savings',
  'transfer_from_savings',
  'withdraw_vesting',
  'fill_vesting_withdraw',
  'claim_reward_balance',
  'delegate_vesting_shares',
  'return_vesting_delegation',
  'interest',
] as const;

export type WalletOpType = (typeof WALLET_OP_TYPES)[number];

const REWARD_SET = new Set<string>(REWARD_OP_TYPES);

export const ACTIVITY_OP_TYPES = WALLET_OP_TYPES.filter(
  (t) => !REWARD_SET.has(t)
) as WalletOpType[];
