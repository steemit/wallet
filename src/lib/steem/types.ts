// Steem.js types

export interface KeyAuthority {
  key_auths: string[][];
  account_auths: [string, number][];
  weight_threshold: number;
}

export interface SteemConfig {
  rpcUrl: string;
  chainId: string;
  addressPrefix: string;
}

export interface SteemAccount {
  id: number;
  name: string;
  owner: KeyAuthority;
  active: KeyAuthority;
  posting: KeyAuthority;
  memo_key: string;
  json_metadata: string;
  /** Newer chains: profile lives here; falls back to json_metadata in normalizer */
  posting_json_metadata?: string;
  balance: string;
  sbd_balance: string;
  savings_balance: string;
  savings_sbd_balance: string;
  vesting_shares: string;
  delegated_vesting_shares: string;
  received_vesting_shares: string;
  vesting_withdraw_rate: string;
  next_vesting_withdrawal: string;
  withdrawn: number;
  to_withdraw: number;
  withdraw_routes: number;
  created: string;
  last_owner_update: string;
  last_account_update: string;
  last_vote_time: string;
  post_count: number;
  can_vote: boolean;
  voting_power: number;
  last_post: string;
  last_root_post: string;
  last_bandwidth_update: string;
  average_bandwidth: number;
  lifetime_bandwidth: number;
  vesting_balance: string;
  reputation: number;
  witness_votes: string[];
}

export interface SignedTransaction {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  operations: Operation[];
  extensions: unknown[];
  signatures: string[];
}

export type Operation = [string, Record<string, unknown>];

export interface BroadcastResult {
  id: string;
  block_num: number;
  trx_num: number;
  expired: boolean;
}

export interface GlobalProperties {
  head_block_number: number;
  head_block_id: string;
  time: string;
  current_witness: string;
  total_pow: number;
  num_pow_witnesses: number;
  virtual_supply: string;
  current_supply: string;
  confidential_supply: string;
  current_sbd_supply: string;
  confidential_sbd_supply: string;
  total_vesting_fund_steem: string;
  total_vesting_shares: string;
  total_reward_fund_steem: string;
  total_reward_shares2: string;
  average_block_size: number;
  maximum_block_size: number;
  current_aslot: number;
  recent_slots_filled: string;
  participation_count: number;
  last_irreversible_block_num: number;
  vote_power_reserve_rate: number;
}

export interface VestingDelegation {
  delegator: string;
  delegatee: string;
  vesting_shares: string;
  min_delegation_time: string;
}

export interface ExpiringVestingDelegation {
  id: number;
  delegator: string;
  delegatee: string;
  vesting_shares: string;
  expiration: string;
}

export interface Witness {
  id: number;
  owner: string;
  created: string;
  url: string;
  total_votes: string;
  position: number;
  running_version: string;
  hardfork_version_vote: string;
  hardfork_time_vote: string;
  available_witness_account: string;
  current_signing_key: string;
  prop_chain_id: string;
  last_confirmed_block_num: number;
  total_missed: number;
  virtual_last_update: number;
  virtual_position: number;
  virtual_scheduled_time: string;
  last_work: string;
  signing_key: string;
  votes: string;
  schedule: string;
 _skeets_json_metadata: string;
}
