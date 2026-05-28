'use client';

import { steem } from '@steemit/steem-js';

import { unixSecToSteemIsoTimestamp } from '@/lib/steem/chain-time';

import type {
  Operation,
  SignedTransaction,
  SteemAccount,
  GlobalProperties,
  BroadcastResult,
  OwnerHistoryEntry,
} from './types';
import { buildAccountCreateOperation } from '@/lib/wallet/community';

export type TransactionHeaderFields = {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
};

async function fetchTransactionHeader(): Promise<TransactionHeaderFields> {
  const response = await fetch('/api/query/transaction-header');
  const data = (await response.json()) as {
    success?: boolean;
    ref_block_num?: unknown;
    ref_block_prefix?: unknown;
    expiration?: unknown;
    error?: string;
  };

  if (!response.ok || !data.success) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Failed to get transaction header'
    );
  }

  if (
    typeof data.ref_block_num !== 'number' ||
    !Number.isFinite(data.ref_block_num) ||
    typeof data.ref_block_prefix !== 'number' ||
    !Number.isFinite(data.ref_block_prefix) ||
    typeof data.expiration !== 'string' ||
    data.expiration.length === 0
  ) {
    throw new Error(
      typeof data.error === 'string' ? data.error : 'Failed to get transaction header'
    );
  }

  return {
    ref_block_num: data.ref_block_num,
    ref_block_prefix: data.ref_block_prefix,
    expiration: data.expiration,
  };
}

/**
 * SteemSigner - Client-side transaction signing module
 * IMPORTANT: Private keys NEVER leave the browser
 */
export class SteemSigner {
  /**
   * Sign a transaction with private keys (client-side only).
   * Fetches ref block + expiration from the server (same rules as steem-js broadcast prep).
   */
  static async signTransaction(
    operations: Operation[],
    privateKeys: string[]
  ): Promise<SignedTransaction> {
    const header = await fetchTransactionHeader();
    const tx = {
      ...header,
      operations,
      extensions: [] as unknown[],
    };

    const signed = steem.auth.signTransaction(tx, privateKeys);
    return steem.auth.normalizeTransactionForBroadcast(
      signed as unknown as Record<string, unknown>
    ) as unknown as SignedTransaction;
  }

  /**
   * Sign a transfer operation
   */
  static async signTransfer(
    from: string,
    to: string,
    amount: string,
    memo: string,
    activeKey: string
  ): Promise<SignedTransaction> {
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

    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Move liquid STEEM/SBD into savings (transfer_to_savings).
   */
  static async signTransferToSavings(
    from: string,
    to: string,
    amount: string,
    memo: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'transfer_to_savings',
        {
          from,
          to,
          amount,
          memo: memo || '',
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Withdraw from savings to liquid (transfer_from_savings).
   */
  static async signTransferFromSavings(
    from: string,
    to: string,
    amount: string,
    memo: string,
    requestId: number,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'transfer_from_savings',
        {
          from,
          to,
          amount,
          memo: memo || '',
          request_id: requestId,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Power up: move liquid STEEM to own vesting (transfer_to_vesting).
   */
  static async signTransferToVesting(
    from: string,
    to: string,
    amount: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'transfer_to_vesting',
        {
          from,
          to,
          amount,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a power down operation
   */
  static async signPowerDown(
    account: string,
    vestingShares: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'withdraw_vesting',
        {
          account,
          vesting_shares: vestingShares,
        },
      ],
    ];

    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a delegate vesting shares operation
   */
  static async signDelegate(
    delegator: string,
    delegatee: string,
    vestingShares: string,
    activeKey: string
  ): Promise<SignedTransaction> {
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

    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a vote operation
   */
  static async signVote(
    voter: string,
    author: string,
    permlink: string,
    weight: number,
    postingKey: string
  ): Promise<SignedTransaction> {
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

    return await this.signTransaction(operations, [postingKey]);
  }

  /**
   * Sign a witness vote operation
   */
  static async signWitnessVote(
    account: string,
    witness: string,
    approve: boolean,
    activeKey: string
  ): Promise<SignedTransaction> {
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

    return await this.signTransaction(operations, [activeKey]);
  }

  static async signUpdateProposalVotes(
    voter: string,
    proposalIds: number[],
    approve: boolean,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'update_proposal_votes',
        {
          voter,
          proposal_ids: proposalIds,
          approve,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signCreateProposal(
    creator: string,
    receiver: string,
    startDate: string,
    endDate: string,
    dailyPay: string,
    subject: string,
    permlink: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'create_proposal',
        {
          creator,
          receiver,
          start_date: startDate,
          end_date: endDate,
          daily_pay: dailyPay,
          subject,
          permlink,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signRemoveProposal(
    proposalOwner: string,
    proposalIds: number[],
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'remove_proposal',
        {
          proposal_owner: proposalOwner,
          proposal_ids: proposalIds,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Sign a witness proxy operation
   */
  static async signWitnessProxy(
    account: string,
    proxy: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'account_witness_proxy',
        {
          account,
          proxy,
        },
      ],
    ];

    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Set power-down withdraw routing (set_withdraw_vesting_route).
   * `percent` is chain units (legacy: Math.round(uiPercent * 100)).
   */
  static async signSetWithdrawVestingRoute(
    fromAccount: string,
    toAccount: string,
    percent: number,
    autoVest: boolean,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'set_withdraw_vesting_route',
        {
          from_account: fromAccount,
          to_account: toAccount,
          percent,
          auto_vest: autoVest,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  /**
   * Request SBD to STEEM conversion over the feed delay (convert).
   */
  static async signConvert(
    owner: string,
    requestid: number,
    amount: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'convert',
        {
          owner,
          requestid,
          amount,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signLimitOrderCreate(
    owner: string,
    amountToSell: string,
    minToReceive: string,
    orderid: number,
    expiration: number,
    activeKey: string,
    fillOrKill = false
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'limit_order_create',
        {
          owner,
          amount_to_sell: amountToSell,
          min_to_receive: minToReceive,
          fill_or_kill: fillOrKill,
          // condenser_api expects ISO time_point_sec in JSON, not unix seconds
          expiration: unixSecToSteemIsoTimestamp(expiration),
          orderid,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signLimitOrderCancel(
    owner: string,
    orderid: number,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operations: Operation[] = [
      [
        'limit_order_cancel',
        {
          owner,
          orderid,
        },
      ],
    ];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signAccountCreate(
    creator: string,
    communityOwnerName: string,
    communityOwnerPassword: string,
    activeKey: string
  ): Promise<SignedTransaction> {
    const operation = buildAccountCreateOperation(
      creator,
      communityOwnerName,
      communityOwnerPassword
    );
    const operations: Operation[] = [['account_create', operation]];
    return await this.signTransaction(operations, [activeKey]);
  }

  static async signOperations(
    operations: Operation[],
    privateKeys: string[]
  ): Promise<SignedTransaction> {
    return await this.signTransaction(operations, privateKeys);
  }

  /** Sign an account_update operation (password / authority rotation). */
  static async signAccountUpdate(
    operation: Operation,
    ownerKey: string
  ): Promise<SignedTransaction> {
    const normalized = steem.auth.normalizeOperationForBroadcast(operation) as Operation;
    return await this.signTransaction([normalized], [ownerKey]);
  }

  /**
   * Sign a recover_account operation (client-side).
   * Derives owner keys from passwords and signs with the OLD owner private key.
   * The signed transaction must then be broadcast via apiClient.broadcastRecoverAccountTx().
   *
   * Prerequisite: The admin must have already broadcast `request_account_recovery`
   * on-chain (via Conveyor / turtle) so that the new_owner_authority is set.
   */
  static signRecoverAccount(
    accountToRecover: string,
    oldPassword: string,
    newPassword: string
  ): { signedTx: Promise<SignedTransaction>; oldOwnerPub: string; newOwnerPub: string } {
    // Derive WIF private keys from passwords
    const oldOwnerPriv = steem.auth.toWif(accountToRecover, oldPassword, 'owner');
    const newOwnerPriv = steem.auth.toWif(accountToRecover, newPassword, 'owner');

    // Derive public keys for the authority objects
    const oldOwnerPub = steem.auth.getPublicKey(oldOwnerPriv);
    const newOwnerPub = steem.auth.getPublicKey(newOwnerPriv);

    const recentOwnerAuthority = {
      weight_threshold: 1,
      account_auths: [] as [string, number][],
      key_auths: [[oldOwnerPub, 1]] as [string, number][],
    };
    const newOwnerAuthority = {
      weight_threshold: 1,
      account_auths: [] as [string, number][],
      key_auths: [[newOwnerPub, 1]] as [string, number][],
    };

    const operation: Operation = [
      'recover_account',
      {
        account_to_recover: accountToRecover,
        new_owner_authority: newOwnerAuthority,
        recent_owner_authority: recentOwnerAuthority,
      },
    ];

    return {
      signedTx: this.signTransaction([operation], [oldOwnerPriv]),
      oldOwnerPub,
      newOwnerPub,
    };
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
  const token = match?.[1];
  return token ? decodeURIComponent(token) : null;
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
   * Ref block + expiration for signing (GET, no CSRF).
   */
  async getTransactionHeader(): Promise<TransactionHeaderFields> {
    return fetchTransactionHeader();
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
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/witness-vote', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastProposalVote(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/proposal-vote', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastProposalCreate(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/proposal-create', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastProposalRemove(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/proposal-remove', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Broadcast a signed witness proxy
   */
  async broadcastWitnessProxy(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/witness-proxy', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  /**
   * Get account information
   */
  async getAccounts(
    usernames: string[],
    options?: { fresh?: boolean }
  ): Promise<{ accounts: SteemAccount[]; error?: string }> {
    const url = `/api/query/accounts?names=${usernames.join(',')}`;
    const response = options?.fresh
      ? await fetch(url, { cache: 'no-store' })
      : await fetch(url);
    return response.json();
  },

  /**
   * Get account history. `from` defaults to the latest history index; pass a
   * positive integer (paired with `limit <= from`) to page into older entries.
   * Pass `ops` to request server-side filtering — the API returns only those
   * op types, already normalized, plus `nextFrom` and `exhausted` for pagination.
   */
  async getHistory(
    username: string,
    limit: number = 100,
    from?: number,
    ops?: string[]
  ): Promise<{ history: unknown[]; nextFrom?: number | null; exhausted?: boolean; error?: string }> {
    const params = new URLSearchParams({
      username,
      limit: String(limit),
    });
    if (typeof from === 'number') params.set('from', String(from));
    if (ops && ops.length > 0) params.set('ops', ops.join(','));
    const response = await fetch(`/api/query/history?${params.toString()}`);
    return response.json();
  },
  async getOwnerHistory(
    username: string
  ): Promise<{ success?: boolean; history?: OwnerHistoryEntry[]; error?: string }> {
    const response = await fetch(`/api/query/owner-history?username=${encodeURIComponent(username)}`);
    return response.json();
  },

  async initiateAccountRecoveryWithEmail(payload: {
    contact_email: string;
    account_name: string;
    owner_key: string;
  }): Promise<{ status: 'ok' | 'duplicate' | 'error'; error?: string }> {
    const response = await fetch('/api/recovery/request', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  /**
   * Verify a recovery confirmation code
   */
  async verifyRecoveryCode(
    code: string
  ): Promise<{ status: 'ok' | 'error'; account_name?: string; error?: string }> {
    const response = await fetch(`/api/recovery/verify/${encodeURIComponent(code)}`);
    return response.json();
  },

  /**
   * Confirm account recovery (step 2 — submit new owner keys)
   */
  async confirmAccountRecovery(payload: {
    code: string;
    account_name: string;
    old_owner_key: string;
    new_owner_key: string;
    new_owner_authority: {
      weight_threshold: number;
      account_auths: [string, number][];
      key_auths: [string, number][];
    };
  }): Promise<{ status: 'ok' | 'error'; error?: string }> {
    const response = await fetch('/api/recovery/confirm', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  /**
   * Broadcast a signed recover_account transaction via server relay
   */
  async broadcastRecoverAccountTx(
    signedTx: unknown
  ): Promise<{ success: boolean; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/recover-account', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx }),
    });
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

  /**
   * Outgoing withdraw routes for power down
   */
  async getWithdrawRoutes(
    username: string
  ): Promise<{
    success?: boolean;
    routes?: { to_account: string; percent: number; auto_vest: boolean }[];
    error?: string;
  }> {
    const response = await fetch(
      `/api/query/withdraw-routes?username=${encodeURIComponent(username)}`
    );
    return response.json();
  },

  /**
   * Median SBD/STEEM feed price from chain
   */
  async getMedianHistoryPrice(): Promise<{
    success?: boolean;
    base?: string;
    quote?: string;
    error?: string;
  }> {
    const response = await fetch('/api/query/median-history-price');
    return response.json();
  },

  async broadcastSetWithdrawVestingRoute(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/set-withdraw-vesting-route', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastConvert(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/convert', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastAccountCreate(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/account-create', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastCustomJson(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string }> {
    const response = await fetch('/api/broadcast/custom-json', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastAccountUpdate(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{
    success: boolean;
    result?: BroadcastResult;
    error?: string;
    details?: string;
  }> {
    const response = await fetch('/api/broadcast/account-update', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    const data = (await response.json()) as {
      success?: boolean;
      result?: BroadcastResult;
      error?: string;
      details?: string;
    };
    return {
      success: Boolean(data.success),
      ...(data.result !== undefined ? { result: data.result } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.details !== undefined ? { details: data.details } : {}),
    };
  },

  async getMarketData(params?: {
    username?: string;
    since?: string;
  }): Promise<{
    success?: boolean;
    orderbook?: { bids: unknown[]; asks: unknown[] };
    ticker?: unknown;
    trades?: { date: string; type: string; steem: number; sbd: number; price: number; stringPrice: string }[];
    openOrders?: unknown[];
    error?: string;
  }> {
    const qs = new URLSearchParams();
    if (params?.username) qs.set('username', params.username);
    if (params?.since) qs.set('since', params.since);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await fetch(`/api/query/market${suffix}`);
    return response.json();
  },

  async broadcastLimitOrderCreate(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/limit-order-create', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },

  async broadcastLimitOrderCancel(
    signedTx: SignedTransaction,
    username: string
  ): Promise<{ success: boolean; result?: BroadcastResult; error?: string; details?: string }> {
    const response = await fetch('/api/broadcast/limit-order-cancel', {
      method: 'POST',
      headers: withCSRFHeader({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ signedTx, username }),
    });
    return response.json();
  },
};
