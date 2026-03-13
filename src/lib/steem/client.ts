'use client';

import { steem } from '@steemit/steem-js';

import type {
  Operation,
  SignedTransaction,
  SteemAccount,
  GlobalProperties,
  BroadcastResult,
} from './types';

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
    // In steem-js >=1.0, use getPublicKey helper from auth module.
    // This accepts a WIF private key and returns the corresponding public key.
    return steem.auth.getPublicKey(privateKey);
  }

  /**
   * Derive a private key from a master password and role.
   * This never sends the password over the network.
   */
  static derivePrivateKeyFromPassword(
    username: string,
    password: string,
    role: 'owner' | 'active' | 'posting' | 'memo' = 'active'
  ): string {
    return steem.auth.toWif(username, password, role);
  }

  /**
   * Derive all role keys from a master password.
   * Returns a map of role -> WIF private key.
   */
  static getPrivateKeysFromMasterPassword(
    username: string,
    password: string
  ): { [role: string]: string } {
    return steem.auth.getPrivateKeys(username, password, ['owner', 'active', 'posting', 'memo']);
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

function getCSRFCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function withCSRFHeader(baseHeaders: HeadersInit = {}): HeadersInit {
  const token = getCSRFCookie();
  if (!token) return baseHeaders;

  return {
    ...baseHeaders,
    'X-CSRF-Token': token,
  };
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ username, signedChallenge, publicKey }),
    });
    return response.json();
  },

  /**
   * Logout
   */
  async logout(): Promise<{ success: boolean }> {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: withCSRFHeader(),
    });
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
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
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
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
