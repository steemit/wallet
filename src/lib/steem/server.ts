// Server-side Steem service
// All communication with Steem nodes happens here

import { steem } from '@steemit/steem-js';

import type {
  SteemAccount,
  SignedTransaction,
  BroadcastResult,
  GlobalProperties,
} from './types';

// Steem configuration from environment; support multiple URLs for failover
const STEEM_RPC_URLS = (process.env.STEEM_RPC_URL || 'https://api.steemit.com')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

let currentUrlIndex = 0;
function getCurrentRpcUrl(): string {
  return STEEM_RPC_URLS[currentUrlIndex % STEEM_RPC_URLS.length] ?? STEEM_RPC_URLS[0]!;
}

function ensureConfigured(url?: string) {
  const rpcUrl = url ?? getCurrentRpcUrl();
  if (steem?.api?.setOptions) {
    steem.api.setOptions({ url: rpcUrl });
  }
}

async function withFailover<T>(fn: () => Promise<T>): Promise<T> {
  const startIndex = currentUrlIndex;
  let lastError: Error | null = null;
  for (let i = 0; i < STEEM_RPC_URLS.length; i++) {
    currentUrlIndex = (startIndex + i) % STEEM_RPC_URLS.length;
    ensureConfigured(getCurrentRpcUrl());
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < STEEM_RPC_URLS.length - 1) {
        console.warn(`Steem RPC ${getCurrentRpcUrl()} failed, trying next:`, lastError.message);
      }
    }
  }
  throw lastError ?? new Error('Steem RPC failed');
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
    return withFailover(async () => {
      ensureConfigured();
      const accounts = await steem.api.getAccountsAsync(usernames);
      return accounts as SteemAccount[];
    }).catch((error) => {
      console.error('Error fetching accounts:', error);
      throw new Error(`Failed to fetch accounts: ${(error as Error).message}`);
    });
  }

  /**
   * Get account history
   */
  static async getAccountHistory(
    username: string,
    limit: number = 10
  ): Promise<unknown[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getAccountHistoryAsync: (account: string, index: number, limit: number) => Promise<unknown[]>;
      };
      return await api.getAccountHistoryAsync(username, -1, limit);
    }).catch((error) => {
      console.error('Error fetching account history:', error);
      throw new Error(`Failed to fetch history: ${(error as Error).message}`);
    });
  }

  /**
   * Get witnesses list (by vote)
   */
  static async getWitnessesByVote(limit: number = 100): Promise<unknown[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getWitnessesByVoteAsync: (start: string, limit: number) => Promise<unknown[]>;
      };
      return await api.getWitnessesByVoteAsync('', limit);
    }).catch((error) => {
      console.error('Error fetching witnesses:', error);
      throw new Error(`Failed to fetch witnesses: ${(error as Error).message}`);
    });
  }

  /**
   * Get witness by account
   */
  static async getWitness(account: string): Promise<unknown> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getWitnessByAccountAsync: (account: string) => Promise<unknown>;
      };
      return await api.getWitnessByAccountAsync(account);
    }).catch((error) => {
      console.error('Error fetching witness:', error);
      throw new Error(`Failed to fetch witness: ${(error as Error).message}`);
    });
  }

  /**
   * Get global properties
   */
  static async getGlobalProperties(): Promise<GlobalProperties> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getDynamicGlobalPropertiesAsync: () => Promise<GlobalProperties>;
      };
      const props = await api.getDynamicGlobalPropertiesAsync();
      return props as GlobalProperties;
    }).catch((error) => {
      console.error('Error fetching global properties:', error);
      throw new Error(`Failed to fetch global properties: ${(error as Error).message}`);
    });
  }

  /**
   * Outgoing power-down withdraw routes (condenser_api.get_withdraw_routes).
   */
  static async getWithdrawRoutesOutgoing(
    account: string
  ): Promise<{ to_account: string; percent: number; auto_vest: boolean }[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown[]) => Promise<unknown>;
      };
      const raw = await api.callAsync('condenser_api.get_withdraw_routes', [account, 'outgoing']);
      if (!Array.isArray(raw)) return [];
      return raw.map((row: Record<string, unknown>) => {
        const to = (row.to_account ?? row.to ?? '') as string;
        const percent = Number(row.percent ?? 0);
        const auto_vest = Boolean(row.auto_vest);
        return { to_account: to, percent, auto_vest };
      });
    }).catch((error) => {
      console.error('Error fetching withdraw routes:', error);
      throw new Error(`Failed to fetch withdraw routes: ${(error as Error).message}`);
    });
  }

  /**
   * Median history price for SBD/STEEM feed (condenser_api.get_current_median_history_price).
   */
  static async getCurrentMedianHistoryPrice(): Promise<{ base: string; quote: string }> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown[]) => Promise<unknown>;
      };
      const result = (await api.callAsync('condenser_api.get_current_median_history_price', [])) as {
        base?: string;
        quote?: string;
      };
      const base = typeof result?.base === 'string' ? result.base : '0 SBD';
      const quote = typeof result?.quote === 'string' ? result.quote : '0 STEEM';
      return { base, quote };
    }).catch((error) => {
      console.error('Error fetching median history price:', error);
      throw new Error(`Failed to fetch median history price: ${(error as Error).message}`);
    });
  }

  /**
   * Get feed history (price)
   */
  static async getFeedHistory(): Promise<unknown> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as { getFeedHistoryAsync: () => Promise<unknown> };
      return await api.getFeedHistoryAsync();
    }).catch((error) => {
      console.error('Error fetching feed history:', error);
      throw new Error(`Failed to fetch feed history: ${(error as Error).message}`);
    });
  }

  /**
   * Broadcast a signed transaction
   */
  static async broadcastTransaction(signedTx: SignedTransaction): Promise<BroadcastResult> {
    return withFailover(async () => {
      ensureConfigured();
      const result = await steem.api.broadcastTransactionAsync(signedTx);
      return result as BroadcastResult;
    }).catch((error) => {
      console.error('Error broadcasting transaction:', error);
      throw new Error(`Failed to broadcast: ${(error as Error).message}`);
    });
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
      const recovered = steem.auth.verifySignature(challenge, signature, publicKey);
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
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getDynamicGlobalPropertiesAsync: () => Promise<{
          head_block_number: number;
          head_block_id: string;
          time: string;
        }>;
      };
      const props = await api.getDynamicGlobalPropertiesAsync();
      return {
        block_number: props.head_block_number,
        block_id: props.head_block_id,
        timestamp: props.time,
      };
    }).catch((error) => {
      console.error('Error fetching block header:', error);
      throw new Error(`Failed to fetch block header: ${(error as Error).message}`);
    });
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
