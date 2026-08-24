/** Account fields used by wallet balance UI (balances tab). */
export interface WalletBalanceData {
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  delegated_vesting_shares: string;
  received_vesting_shares: string;
  vesting_withdraw_rate: string;
  savings_balance: string;
  savings_sbd_balance: string;
  next_vesting_withdrawal: string;
  to_withdraw: string;
  withdrawn: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_steem: string;
}

export interface GlobalPropsData {
  total_vesting_shares: string;
  total_vesting_fund_steem: string;
  /** Present in the full dynamic global properties payload; used for SP APR. */
  head_block_number?: number;
  virtual_supply?: string;
  vesting_reward_percent?: number;
}
