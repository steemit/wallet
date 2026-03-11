'use client';

import type {
  Operation,
  SignedTransaction,
  SteemAccount,
  GlobalProperties,
  BroadcastResult,
} from './types';

// Dynamic import for steem-js to handle SSR
// eslint-disable-next-line @typescript-eslint/no-require-imports
const steem = require('@steemit/steem-js');

/**
 * SteemSigner - Client-side transaction signing module
 * IMPORTANT: Private keys NEVER leave the browser
 */
export class SteemSigner {
  /**
   * Sign a transaction with private keys (client-side only)
   */
  static signTransaction(
    operations: Operation[],
    privateKeys: string[]
  ): SignedTransaction {
    const tx = {
      operations,
      extensions: [],
    };

    // Use steem-js to sign
    const signed = steem.auth.signTransaction(tx, privateKeys);
    return signed as SignedTransaction;
  }

  /**
   * Sign a transfer operation
   */
  static signTransfer(
    from: string,
    to: string,
    amount: string,
    memo: string,
    activeKey: string
  ): SignedTransaction {
    const operations: Operation[] = [
      [
        'transfer',
        {
          from,
          to,
          amount,
          memo,
        },
      ],
    ];

    return this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a power down operation
   */
  static signPowerDown(
    account: string,
    vestingShares: string,
    activeKey: string
  ): SignedTransaction {
    const operations: Operation[] = [
      [
        'withdraw_vesting',
        {
          account,
          vesting_shares: vestingShares,
        },
      ],
    ];

    return this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a delegate vesting shares operation
   */
  static signDelegate(
    delegator: string,
    delegatee: string,
    vestingShares: string,
    activeKey: string
  ): SignedTransaction {
    const operations: Operation[] = [
      [
        'delegate_vesting_shares',
        {
          delegator,
          delegatee,
          vesting_shares: vestingShares,
        },
      ],
    ];

    return this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a vote operation
   */
  static signVote(
    voter: string,
    author: string,
    permlink: string,
    weight: number,
    postingKey: string
  ): SignedTransaction {
    const operations: Operation[] = [
      [
        'vote',
        {
          voter,
          author,
          permlink,
          weight,
        },
      ],
    ];

    return this.signTransaction(operations, [postingKey]);
  }

  /**
   * Sign a witness vote operation
   */
  static signWitnessVote(
    account: string,
    witness: string,
    approve: boolean,
    activeKey: string
  ): SignedTransaction {
    const operations: Operation[] = [
      [
        'account_witness_vote',
        {
          account,
          witness,
          approve,
        },
      ],
    ];

    return this.signTransaction(operations, [activeKey]);
  }

  /**
   * Get public key from private key
   */
  static privateKeyToPublicKey(privateKey: string): string {
    return steem.auth.privateToPublic(privateKey);
  }

  /**
   * Generate a random challenge string for login verification
   */
  static generateChallenge(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}`;
  }

  /**
   * Sign a login challenge
   */
  static signChallenge(challenge: string, privateKey: string): string {
    return steem.auth.sign(challenge, privateKey);
  }

  /**
   * Verify if a private key matches a public key
   */
  static verifyPrivateKey(privateKey: string, expectedPublicKey: string): boolean {
    try {
      const derivedPublicKey = this.privateKeyToPublicKey(privateKey);
      return derivedPublicKey === expectedPublicKey;
    } catch {
      return false;
    }
  }

  /**
   * Validate private key format
   */
  static isValidPrivateKey(key: string): boolean {
    return steem.auth.isWif(key);
  }
}

/**
 * API Client for communicating with Next.js API routes
 */
export const apiClient = {
  /**
   * Get login challenge
   */
  async getChallenge(username: string): Promise<{ challenge: string }> {
    const response = await fetch(`/api/auth/challenge?username=${encodeURIComponent(username)}`);
    if (!response.ok) {
      throw new Error('Failed to get challenge');
    }
    return response.json();
  },

  /**
   * Login with signed challenge
   */
  async login(username: string, signedChallenge: string, publicKey: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, signedChallenge, publicKey }),
    });
    return response.json();
  },

  /**
   * Logout
   */
  async logout(): Promise<{ success: boolean }> {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    return response.json();
  },

  /**
   * Broadcast a signed transfer
   */
  async broadcastTransfer(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Broadcast a signed power down
   */
  async broadcastPowerDown(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/power-down', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Broadcast a signed delegate operation
   */
  async broadcastDelegate(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Broadcast a signed vote
   */
  async broadcastVote(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Broadcast a signed witness vote
   */
  async broadcastWitnessVote(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/witness-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Get account information
   */
  async getAccounts(usernames: string[]): Promise<{ accounts: SteemAccount[]; error?: string }> {
    const response = await fetch(`/api/query/accounts?names=${usernames.join(',')}`);
    return response.json();
  },

  /**
   * Get account history
   */
  async getHistory(username: string, limit: number = 100): Promise<{ history: unknown[]; error?: string }> {
    const response = await fetch(`/api/query/history?username=${username}&limit=${limit}`);
    return response.json();
  },

  /**
   * Get witnesses list
   */
  async getWitnesses(limit: number = 100): Promise<{ witnesses: unknown[]; error?: string }> {
    const response = await fetch(`/api/query/witnesses?limit=${limit}`);
    return response.json();
  },

  /**
   * Get global properties
   */
  async getGlobalProps(): Promise<{ props: GlobalProperties; error?: string }> {
    const response = await fetch('/api/query/global-props');
    return response.json();
  },
};
