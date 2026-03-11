// Server-side Steem service
// All communication with Steem nodes happens here

import type {
  SteemAccount,
  SignedTransaction,
  BroadcastResult,
  GlobalProperties,
} from './types';

// Steem configuration from environment
const STEEM_RPC_URL = process.env.STEEM_RPC_URL || 'https://api.steemit.com';

// Dynamic import steem-js for server-side
// eslint-disable-next-line @typescript-eslint/no-require-imports
const steem = require('@steemit/steem-js');

// Configure steem-js lazily when first accessed
let configured = false;
function ensureConfigured() {
  if (!configured && steem?.api?.setOptions) {
    steem.api.setOptions({ url: STEEM_RPC_URL });
    configured = true;
  }
}

/**
 * Server-side Steem service
 * Handles all communication with Steem blockchain nodes
 */
export class SteemService {
  /**
   * Get account information
   */
  static async getAccounts(usernames: string[]): Promise<SteemAccount[]> {
    try {
      ensureConfigured();
      const accounts = await steem.api.getAccountsAsync(usernames);
      return accounts as SteemAccount[];
    } catch (error) {
      console.error('Error fetching accounts:', error);
      throw new Error(`Failed to fetch accounts: ${(error as Error).message}`);
    }
  }

  /**
   * Get account history
   */
  static async getAccountHistory(
    username: string,
    limit: number = 100
  ): Promise<unknown[]> {
    try {
      ensureConfigured();
      const history = await steem.api.getAccountHistoryAsync(username, -1, limit);
      return history;
    } catch (error) {
      console.error('Error fetching account history:', error);
      throw new Error(`Failed to fetch history: ${(error as Error).message}`);
    }
  }

  /**
   * Get witnesses list (by vote)
   */
  static async getWitnessesByVote(limit: number = 100): Promise<unknown[]> {
    try {
      ensureConfigured();
      const witnesses = await steem.api.getWitnessesByVoteAsync('', limit);
      return witnesses;
    } catch (error) {
      console.error('Error fetching witnesses:', error);
      throw new Error(`Failed to fetch witnesses: ${(error as Error).message}`);
    }
  }

  /**
   * Get witness by account
   */
  static async getWitness(account: string): Promise<unknown> {
    try {
      ensureConfigured();
      const witness = await steem.api.getWitnessByAccountAsync(account);
      return witness;
    } catch (error) {
      console.error('Error fetching witness:', error);
      throw new Error(`Failed to fetch witness: ${(error as Error).message}`);
    }
  }

  /**
   * Get global properties
   */
  static async getGlobalProperties(): Promise<GlobalProperties> {
    try {
      ensureConfigured();
      const props = await steem.api.getDynamicGlobalPropertiesAsync();
      return props as GlobalProperties;
    } catch (error) {
      console.error('Error fetching global properties:', error);
      throw new Error(`Failed to fetch global properties: ${(error as Error).message}`);
    }
  }

  /**
   * Get feed history (price)
   */
  static async getFeedHistory(): Promise<unknown> {
    try {
      ensureConfigured();
      const feed = await steem.api.getFeedHistoryAsync();
      return feed;
    } catch (error) {
      console.error('Error fetching feed history:', error);
      throw new Error(`Failed to fetch feed history: ${(error as Error).message}`);
    }
  }

  /**
   * Broadcast a signed transaction
   */
  static async broadcastTransaction(signedTx: SignedTransaction): Promise<BroadcastResult> {
    try {
      ensureConfigured();
      const result = await steem.api.broadcastTransactionAsync(signedTx);
      return result as BroadcastResult;
    } catch (error) {
      console.error('Error broadcasting transaction:', error);
      throw new Error(`Failed to broadcast: ${(error as Error).message}`);
    }
  }

  /**
   * Verify a signature (server-side validation)
   * Note: This doesn't re-sign, just validates the signature format
   */
  static async verifySignature(signedTx: SignedTransaction): Promise<boolean> {
    try {
      // Basic validation
      if (!signedTx.signatures || signedTx.signatures.length === 0) {
        return false;
      }

      // Check if transaction has required fields
      if (
        !signedTx.ref_block_num ||
        !signedTx.ref_block_prefix ||
        !signedTx.expiration ||
        !signedTx.operations ||
        signedTx.operations.length === 0
      ) {
        return false;
      }

      // The actual signature verification would happen during broadcast
      // If the signature is invalid, the network will reject it
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify a signed challenge for login
   */
  static verifyChallengeSignature(
    challenge: string,
    signature: string,
    publicKey: string
  ): boolean {
    try {
      ensureConfigured();
      const recovered = steem.auth.signatureVerify(challenge, signature, publicKey);
      return recovered;
    } catch {
      return false;
    }
  }

  /**
   * Get current block header (for transaction ref_block)
   */
  static async getCurrentBlockHeader(): Promise<{
    block_number: number;
    block_id: string;
    timestamp: string;
  }> {
    try {
      ensureConfigured();
      const props = await steem.api.getDynamicGlobalPropertiesAsync();
      return {
        block_number: props.head_block_number,
        block_id: props.head_block_id,
        timestamp: props.time,
      };
    } catch (error) {
      console.error('Error fetching block header:', error);
      throw new Error(`Failed to fetch block header: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a login challenge
   */
  static generateChallenge(username: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `login-${username}-${timestamp}-${random}`;
  }

  /**
   * Get key type from public key format
   */
  static getKeyType(publicKey: string): 'owner' | 'active' | 'posting' | 'memo' | null {
    const prefix = publicKey.substring(0, 3);
    if (prefix !== 'STM' && prefix !== 'TST') {
      return null;
    }

    // This is a simplified check
    // In practice, you'd need to check the account's keys
    return 'active'; // Default to active for most operations
  }
}

/**
 * Health check for Steem node connection
 */
export async function checkSteemNodeHealth(): Promise<{
  healthy: boolean;
  blockNumber?: number;
  latency?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    const props = await SteemService.getGlobalProperties();
    const latency = Date.now() - start;

    return {
      healthy: true,
      blockNumber: props.head_block_number,
      latency,
    };
  } catch (error) {
    return {
      healthy: false,
      error: (error as Error).message,
    };
  }
}
