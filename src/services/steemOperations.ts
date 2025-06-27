
import * as dsteem from 'dsteem';
import { getPrimaryEndpoint } from '@/config/api';

// Initialize dsteem client with centralized endpoint configuration
const client = new dsteem.Client(getPrimaryEndpoint());

export interface TransferOperation {
  from: string;
  to: string;
  amount: string;
  memo: string;
}

export interface PowerUpOperation {
  from: string;
  to: string;
  amount: string;
}

export interface DelegateOperation {
  delegator: string;
  delegatee: string;
  vesting_shares: string;
}

export interface SavingsOperation {
  from: string;
  to: string;
  amount: string;
  memo: string;
}

export interface WithdrawSavingsOperation {
  from: string;
  to: string;
  amount: string;
  memo: string;
  request_id: number;
}

export interface WithdrawVestingRouteOperation {
  from_account: string;
  to_account: string;
  percent: number;
  auto_vest: boolean;
}

export interface ProposalVoteOperation {
  voter: string;
  proposal_ids: number[];
  approve: boolean;
}

export interface ResetAccountOperation {
  reset_account: string;
  account_to_reset: string;
  new_owner_authority: any;
}

export interface SetResetAccountOperation {
  account: string;
  current_reset_account: string;
  reset_account: string;
}

export interface PasswordChangeData {
  username: string;
  oldPassword: string;
  newPassword: string;
}

export class SteemOperationsService {
  
  // Transfer STEEM or SBD
  async transfer(operation: TransferOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    return client.broadcast.transfer(operation, privateKey);
  }

  // Power up STEEM to STEEM Power (transfer to vesting)
  async powerUp(operation: PowerUpOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const transferToVestingOp: dsteem.Operation = [
      'transfer_to_vesting',
      {
        from: operation.from,
        to: operation.to,
        amount: operation.amount
      }
    ];
    return client.broadcast.sendOperations([transferToVestingOp], privateKey);
  }

  // Power down (withdraw vesting)
  async powerDown(from: string, vesting_shares: string, privateKey: dsteem.PrivateKey): Promise<any> {
    const withdrawVestingOp: dsteem.Operation = [
      'withdraw_vesting',
      {
        account: from,
        vesting_shares: vesting_shares
      }
    ];
    return client.broadcast.sendOperations([withdrawVestingOp], privateKey);
  }

  // Delegate STEEM Power
  async delegateVestingShares(operation: DelegateOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    return client.broadcast.delegateVestingShares(operation, privateKey);
  }

  // Remove delegation (set vesting_shares to "0.000000 VESTS")
  async removeDelegation(delegator: string, delegatee: string, privateKey: dsteem.PrivateKey): Promise<any> {
    const operation: DelegateOperation = {
      delegator,
      delegatee,
      vesting_shares: "0.000000 VESTS"
    };
    return client.broadcast.delegateVestingShares(operation, privateKey);
  }

  // Transfer to savings
  async transferToSavings(operation: SavingsOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const transferToSavingsOp: dsteem.Operation = [
      'transfer_to_savings',
      {
        from: operation.from,
        to: operation.to,
        amount: operation.amount,
        memo: operation.memo
      }
    ];
    return client.broadcast.sendOperations([transferToSavingsOp], privateKey);
  }

  // Transfer from savings
  async transferFromSavings(operation: WithdrawSavingsOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const transferFromSavingsOp: dsteem.Operation = [
      'transfer_from_savings',
      {
        from: operation.from,
        to: operation.to,
        amount: operation.amount,
        memo: operation.memo,
        request_id: operation.request_id
      }
    ];
    return client.broadcast.sendOperations([transferFromSavingsOp], privateKey);
  }

  // Cancel transfer from savings
  async cancelTransferFromSavings(from: string, request_id: number, privateKey: dsteem.PrivateKey): Promise<any> {
    const cancelTransferFromSavingsOp: dsteem.Operation = [
      'cancel_transfer_from_savings',
      {
        from,
        request_id
      }
    ];
    return client.broadcast.sendOperations([cancelTransferFromSavingsOp], privateKey);
  }

  // Set withdraw vesting route
  async setWithdrawVestingRoute(operation: WithdrawVestingRouteOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const setWithdrawVestingRouteOp: dsteem.Operation = [
      'set_withdraw_vesting_route',
      {
        from_account: operation.from_account,
        to_account: operation.to_account,
        percent: operation.percent,
        auto_vest: operation.auto_vest
      }
    ];
    return client.broadcast.sendOperations([setWithdrawVestingRouteOp], privateKey);
  }

  // Update proposal votes
  async updateProposalVotes(operation: ProposalVoteOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const updateProposalVotesOp: dsteem.Operation = [
      'update_proposal_votes',
      {
        voter: operation.voter,
        proposal_ids: operation.proposal_ids,
        approve: operation.approve
      }
    ];
    return client.broadcast.sendOperations([updateProposalVotesOp], privateKey);
  }

  // Generic broadcast operation method
  async broadcastOperation(operations: dsteem.Operation[], privateKey: dsteem.PrivateKey): Promise<any> {
    return client.broadcast.sendOperations(operations, privateKey);
  }

  // Helper method to convert STEEM to VESTS (for delegation operations)
  async convertSteemToVests(steemAmount: string): Promise<string> {
    try {
      const props = await client.database.getDynamicGlobalProperties();
      
      // Handle both string and Asset types
      const totalVestingFundAmount = typeof props.total_vesting_fund_steem === 'string' 
        ? props.total_vesting_fund_steem 
        : props.total_vesting_fund_steem.toString();
      
      const totalVestingSharesAmount = typeof props.total_vesting_shares === 'string'
        ? props.total_vesting_shares
        : props.total_vesting_shares.toString();
      
      const totalVestingFund = parseFloat(totalVestingFundAmount.split(' ')[0]);
      const totalVestingShares = parseFloat(totalVestingSharesAmount.split(' ')[0]);
      
      const steem = parseFloat(steemAmount);
      const vests = (steem * totalVestingShares) / totalVestingFund;
      
      return `${vests.toFixed(6)} VESTS`;
    } catch (error) {
      console.error('Error converting STEEM to VESTS:', error);
      throw error;
    }
  }

  // Helper method to convert VESTS to STEEM (for display purposes)
  async convertVestsToSteem(vestsAmount: string): Promise<string> {
    try {
      const props = await client.database.getDynamicGlobalProperties();
      
      // Handle both string and Asset types
      const totalVestingFundAmount = typeof props.total_vesting_fund_steem === 'string' 
        ? props.total_vesting_fund_steem 
        : props.total_vesting_fund_steem.toString();
      
      const totalVestingSharesAmount = typeof props.total_vesting_shares === 'string'
        ? props.total_vesting_shares
        : props.total_vesting_shares.toString();
      
      const totalVestingFund = parseFloat(totalVestingFundAmount.split(' ')[0]);
      const totalVestingShares = parseFloat(totalVestingSharesAmount.split(' ')[0]);
      
      const vests = parseFloat(vestsAmount);
      const steem = (vests * totalVestingFund) / totalVestingShares;
      
      return `${steem.toFixed(3)} STEEM`;
    } catch (error) {
      console.error('Error converting VESTS to STEEM:', error);
      throw error;
    }
  }

  // Vote for witness
  async voteWitness(account: string, witness: string, approve: boolean, privateKey: dsteem.PrivateKey): Promise<any> {
    const accountWitnessVoteOp: dsteem.Operation = [
      'account_witness_vote',
      {
        account: account,
        witness: witness,
        approve: approve
      }
    ];
    return client.broadcast.sendOperations([accountWitnessVoteOp], privateKey);
  }

  // Set or unset witness proxy
  async setWitnessProxy(account: string, proxy: string, privateKey: dsteem.PrivateKey): Promise<any> {
    const accountWitnessProxyOp: dsteem.Operation = [
      'account_witness_proxy',
      {
        account: account,
        proxy: proxy
      }
    ];
    return client.broadcast.sendOperations([accountWitnessProxyOp], privateKey);
  }

  // Remove witness proxy (set to empty string)
  async removeWitnessProxy(account: string, privateKey: dsteem.PrivateKey): Promise<any> {
    return this.setWitnessProxy(account, '', privateKey);
  }

  // Claim reward balance
  async claimRewardBalance(
    account: string, 
    rewardSteem: string, 
    rewardSbd: string, 
    rewardVests: string, 
    privateKey: dsteem.PrivateKey
  ): Promise<any> {
    const claimRewardBalanceOp: dsteem.Operation = [
      'claim_reward_balance',
      {
        account: account,
        reward_steem: rewardSteem,
        reward_sbd: rewardSbd,
        reward_vests: rewardVests
      }
    ];
    return client.broadcast.sendOperations([claimRewardBalanceOp], privateKey);
  }

  // Reset account operation (requires owner authority)
  async resetAccount(operation: ResetAccountOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const resetAccountOp: dsteem.Operation = [
      'reset_account',
      {
        reset_account: operation.reset_account,
        account_to_reset: operation.account_to_reset,
        new_owner_authority: operation.new_owner_authority
      }
    ];
    return client.broadcast.sendOperations([resetAccountOp], privateKey);
  }

  // Set reset account operation (requires owner authority)
  async setResetAccount(operation: SetResetAccountOperation, privateKey: dsteem.PrivateKey): Promise<any> {
    const setResetAccountOp: dsteem.Operation = [
      'set_reset_account',
      {
        account: operation.account,
        current_reset_account: operation.current_reset_account,
        reset_account: operation.reset_account
      }
    ];
    return client.broadcast.sendOperations([setResetAccountOp], privateKey);
  }

  // Change account password (generates new keys and updates all authorities)
  async changePassword(data: PasswordChangeData, ownerKey: dsteem.PrivateKey): Promise<any> {
    const { username, newPassword } = data;
    
    // Generate new keys from the new password
    const newKeys = this.generateKeys(username, newPassword, ['owner', 'active', 'posting', 'memo']);
    
    // Create new authorities
    const newOwnerAuth = {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[newKeys.owner.public, 1]]
    };
    
    const newActiveAuth = {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[newKeys.active.public, 1]]
    };
    
    const newPostingAuth = {
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[newKeys.posting.public, 1]]
    };
    
    // Update account authorities
    const accountUpdateOp: dsteem.Operation = [
      'account_update',
      {
        account: username,
        owner: newOwnerAuth,
        active: newActiveAuth,
        posting: newPostingAuth,
        memo_key: newKeys.memo.public,
        json_metadata: ''
      }
    ];
    
    return client.broadcast.sendOperations([accountUpdateOp], ownerKey);
  }

  // Authentication utilities
  verify(name: string, password: string, auths: any): boolean {
    // Generate keys from password and verify against authorities
    try {
      const keys = this.generateKeys(name, password, ['owner', 'active', 'posting']);
      
      // Check if any of the generated keys match the authorities
      return Object.keys(keys).some(role => {
        const publicKey = keys[role].public;
        const auth = auths[role];
        
        if (!auth || !auth.key_auths) return false;
        
        return auth.key_auths.some((keyAuth: any) => keyAuth[0] === publicKey);
      });
    } catch {
      return false;
    }
  }

  // Generate keys using the correct Steem method
  generateKeys(name: string, password: string, roles: string[]): any {
    const keys: any = {};
    
    roles.forEach(role => {
      const privateKey = dsteem.PrivateKey.fromSeed(`${name}${role}${password}`);
      keys[role] = {
        private: privateKey.toString(),
        public: privateKey.createPublic().toString()
      };
    });
    
    return keys;
  }

  getPrivateKeys(name: string, password: string, roles: string[]): any {
    return this.generateKeys(name, password, roles);
  }

  isWif(privWif: string): boolean {
    try {
      dsteem.PrivateKey.fromString(privWif);
      return true;
    } catch {
      return false;
    }
  }

  toWif(name: string, password: string, role: string): string {
    const privateKey = dsteem.PrivateKey.fromSeed(`${name}${role}${password}`);
    return privateKey.toString();
  }

  wifIsValid(privWif: string, pubWif: string): boolean {
    try {
      const privateKey = dsteem.PrivateKey.fromString(privWif);
      const publicKey = privateKey.createPublic();
      return publicKey.toString() === pubWif;
    } catch {
      return false;
    }
  }

  wifToPublic(privWif: string): string {
    const privateKey = dsteem.PrivateKey.fromString(privWif);
    return privateKey.createPublic().toString();
  }
}

export const steemOperations = new SteemOperationsService();
