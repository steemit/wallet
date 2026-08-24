// Server-side Steem service
// All communication with Steem nodes happens here

import { randomBytes } from 'crypto';
import { steem } from '@steemit/steem-js';

import { formatSteemIsoTimestamp } from '@/lib/steem/chain-time';

import {
  ORDERBOOK_LIMIT,
  RECENT_TRADES_LIMIT,
} from '@/lib/market/constants';
import {
  parseOpenOrder,
  parseOrderBook,
  parseTicker,
  parseTradeFill,
} from '@/lib/market/parse';
import type {
  MarketOpenOrderRow,
  MarketOrderRow,
  MarketTicker,
  MarketTradeRow,
  RawOrderBookEntry,
} from '@/lib/market/types';
import type {
  SteemAccount,
  SignedTransaction,
  BroadcastResult,
  GlobalProperties,
  VestingDelegation,
  ExpiringVestingDelegation,
  Proposal,
  ProposalOrderBy,
  ProposalOrderDirection,
  ProposalStatus,
  OwnerHistoryEntry,
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
      const result = accounts as SteemAccount[];
      // Legacy parity (SagaShared.getAccount): attach any pending
      // change_recovery_account request for single-account lookups so the
      // wallet UI can warn the owner.
      if (usernames.length === 1 && result.length > 0) {
        const first = result[0];
        const username = usernames[0];
        if (first && username) {
          try {
            const api = steem.api as unknown as {
              callAsync: (method: string, params: unknown) => Promise<unknown>;
            };
            const recoveryData = (await api.callAsync(
              'database_api.find_change_recovery_account_requests',
              { accounts: [username] }
            )) as {
              requests?: {
                account_to_recover: string;
                recovery_account: string;
                effective_on: string;
              }[];
            };
            const request = recoveryData?.requests?.[0];
            if (request && request.account_to_recover === username) {
              first.account_recovery = request;
            }
          } catch (err) {
            console.warn('Error fetching change recovery account request:', err);
          }
        }
      }
      return result;
    }).catch((error) => {
      console.error('Error fetching accounts:', error);
      throw new Error(`Failed to fetch accounts: ${(error as Error).message}`);
    });
  }

  /**
   * Get owner key change history (condenser_api.get_owner_history).
   */
  static async getOwnerHistory(account: string): Promise<OwnerHistoryEntry[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getOwnerHistoryAsync: (name: string) => Promise<OwnerHistoryEntry[]>;
      };
      return (await api.getOwnerHistoryAsync(account)) ?? [];
    }).catch((error) => {
      console.error('Error fetching owner history:', error);
      throw new Error(`Failed to fetch owner history: ${(error as Error).message}`);
    });
  }

  /**
   * Get account history
   */
  static async getAccountHistory(
    username: string,
    limit: number = 10,
    from: number = -1
  ): Promise<unknown[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getAccountHistoryAsync: (account: string, index: number, limit: number) => Promise<unknown[]>;
      };
      return await api.getAccountHistoryAsync(username, from, limit);
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
   * Transaction header fields for client-side signing (matches `@steemit/steem-js` broadcast `_prepareTransaction`).
   * Without these on the signed JSON, server validation and chain broadcast fail.
   */
  static async prepareTransactionHeader(): Promise<{
    ref_block_num: number;
    ref_block_prefix: number;
    expiration: string;
  }> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getDynamicGlobalPropertiesAsync: () => Promise<GlobalProperties>;
        getBlockHeaderAsync?: (blockNum: number) => Promise<{ previous?: string }>;
        getBlockAsync?: (blockNum: number) => Promise<{ previous?: string }>;
        callAsync?: (method: string, params: unknown[]) => Promise<unknown>;
      };

      const properties = await api.getDynamicGlobalPropertiesAsync();
      const timeRaw = properties.time;
      const chainDate = new Date(timeRaw.endsWith('Z') ? timeRaw : `${timeRaw}Z`);
      const refBlockNum = (properties.last_irreversible_block_num - 1) & 0xffff;
      const lib = properties.last_irreversible_block_num;

      let block: { previous?: string } | null = null;
      try {
        if (typeof api.getBlockHeaderAsync === 'function') {
          block = (await api.getBlockHeaderAsync(lib)) as { previous?: string } | null;
        }
      } catch {
        block = null;
      }
      if (!block?.previous) {
        try {
          if (typeof api.getBlockAsync === 'function') {
            block = (await api.getBlockAsync(lib)) as { previous?: string };
          }
        } catch {
          block = null;
        }
      }
      if (!block?.previous && typeof api.callAsync === 'function') {
        try {
          block = (await api.callAsync('database_api.get_block_header', [
            lib,
          ])) as { previous?: string };
        } catch {
          block = null;
        }
      }

      const headBlockId =
        block?.previous ?? '0000000000000000000000000000000000000000';
      const refBlockPrefix = Buffer.from(headBlockId, 'hex').readUInt32LE(4);
      const expiration = formatSteemIsoTimestamp(new Date(chainDate.getTime() + 600 * 1000));

      return {
        ref_block_num: refBlockNum,
        ref_block_prefix: refBlockPrefix,
        expiration,
      };
    }).catch((error) => {
      console.error('Error preparing transaction header:', error);
      throw new Error(`Failed to prepare transaction header: ${(error as Error).message}`);
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
   * STEEM/SBD USD prices for wallet estimated account value (matches wallet-legacy TransactionSaga).
   */
  static async getWalletPrices(): Promise<{ steemPrice: number; sbdPrice: number }> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getFeedHistoryAsync: () => Promise<{
          price_history?: { base: string; quote: string }[];
        }>;
        /**
         * Jussi expects `params` as a single args object for many AppBase methods
         * (e.g. `{ limit: 10 }`), not `[{ limit: 10 }]`, which triggers bad_cast_exception.
         */
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };

      let steemPrice = 0;
      const feedHistory = await api.getFeedHistoryAsync();
      const history = feedHistory?.price_history ?? [];
      const latest = history[history.length - 1];
      if (latest) {
        const base = parseFloat(latest.base.split(' ')[0] || '0');
        const quote = parseFloat(latest.quote.split(' ')[0] || '0');
        if (quote > 0) {
          steemPrice = base / quote;
        }
      }

      let sbdPrice = 0;
      const tradesData = (await api.callAsync('market_history_api.get_recent_trades', {
        limit: 10,
      })) as {
        trades?: {
          current_pays: { amount: string; precision: number; nai: string };
          open_pays: { amount: string; precision: number; nai: string };
        }[];
      };

      let highest: number | null = null;
      let lowest: number | null = null;
      for (const trade of tradesData?.trades ?? []) {
        const currentAmount =
          parseFloat(trade.current_pays.amount) / 10 ** trade.current_pays.precision;
        const openAmount = parseFloat(trade.open_pays.amount) / 10 ** trade.open_pays.precision;
        let steemAmount = 0;
        let sbdAmount = 0;
        if (trade.current_pays.nai === '@@000000021') {
          steemAmount = currentAmount;
          sbdAmount = openAmount;
        } else if (trade.open_pays.nai === '@@000000021') {
          steemAmount = openAmount;
          sbdAmount = currentAmount;
        } else {
          continue;
        }
        if (steemAmount === 0) continue;
        const price = sbdAmount / steemAmount;
        if (highest === null || price > highest) highest = price;
        if (lowest === null || price < lowest) lowest = price;
      }

      if (highest !== null && steemPrice > 0 && highest > 0) {
        sbdPrice = (1 / highest) * steemPrice;
      }

      return { steemPrice, sbdPrice };
    }).catch((error) => {
      console.error('Error fetching wallet prices:', error);
      throw new Error(`Failed to fetch wallet prices: ${(error as Error).message}`);
    });
  }

  /**
   * Pending savings withdrawals, open orders, and SBD conversions for estimate extras.
   * Also returns the detailed rows so the wallet UI can render legacy-parity
   * indicators (pending conversions list, savings withdrawal history).
   */
  static async getWalletEstimateExtras(
    username: string,
    options: { includeOpenOrders?: boolean } = {}
  ): Promise<{
    savingsPendingSteem: number;
    savingsPendingSbd: number;
    conversionTotalSbd: number;
    steemOrders: number;
    sbdOrders: number;
    conversions: { requestid: number; amountSbd: number; finishTime: string }[];
    savingsWithdrawals: {
      id: number;
      requestId: number;
      from: string;
      to: string;
      amount: string;
      memo: string;
      complete: string;
    }[];
  }> {
    const assetPrecision = 1000;
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getSavingsWithdrawToAsync: (account: string) => Promise<
          {
            id: number;
            request_id: number;
            from: string;
            to: string;
            amount: string;
            memo: string;
            complete: string;
          }[]
        >;
        getSavingsWithdrawFromAsync: (account: string) => Promise<
          {
            id: number;
            request_id: number;
            from: string;
            to: string;
            amount: string;
            memo: string;
            complete: string;
          }[]
        >;
        getOpenOrdersAsync: (owner: string) => Promise<
          { for_sale: number; sell_price: { base: string } }[]
        >;
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };

      const [toWithdraws, fromWithdraws] = await Promise.all([
        api.getSavingsWithdrawToAsync(username),
        api.getSavingsWithdrawFromAsync(username),
      ]);

      const withdrawMap = new Map<string, (typeof toWithdraws)[number]>();
      for (const w of [...toWithdraws, ...fromWithdraws]) {
        const id = (w as { id?: number }).id;
        if (id !== undefined) withdrawMap.set(String(id), w);
      }

      let savingsPendingSteem = 0;
      let savingsPendingSbd = 0;
      const savingsWithdrawals: {
        id: number;
        requestId: number;
        from: string;
        to: string;
        amount: string;
        memo: string;
        complete: string;
      }[] = [];
      for (const withdraw of withdrawMap.values()) {
        const [amountStr, asset] = withdraw.amount.split(' ');
        const amount = parseFloat(amountStr || '0');
        if (asset === 'STEEM') savingsPendingSteem += amount;
        else if (asset === 'SBD') savingsPendingSbd += amount;
        savingsWithdrawals.push({
          id: withdraw.id,
          requestId: withdraw.request_id,
          from: withdraw.from,
          to: withdraw.to,
          amount: withdraw.amount,
          memo: withdraw.memo ?? '',
          complete: withdraw.complete,
        });
      }

      let conversionTotalSbd = 0;
      const conversions: { requestid: number; amountSbd: number; finishTime: string }[] = [];
      const now = Date.now();
      try {
        const conversionResult = (await api.callAsync(
          'database_api.find_sbd_conversion_requests',
          { account: username }
        )) as {
          requests?: {
            requestid: number;
            conversion_date: string;
            amount: { amount: string; precision: number };
          }[];
        };
        for (const request of conversionResult?.requests ?? []) {
          const rawTimestamp = request.conversion_date;
          const iso = rawTimestamp.endsWith('Z') ? rawTimestamp : `${rawTimestamp}Z`;
          const finishTime = new Date(iso).getTime();
          if (finishTime < now) continue;
          const amount =
            parseFloat(request.amount.amount) / 10 ** request.amount.precision;
          if (!Number.isNaN(amount)) {
            conversionTotalSbd += amount;
            conversions.push({
              requestid: request.requestid,
              amountSbd: amount,
              finishTime: new Date(finishTime).toISOString(),
            });
          }
        }
      } catch (err) {
        console.warn('find_sbd_conversion_requests failed:', err);
      }

      let steemOrders = 0;
      let sbdOrders = 0;
      if (options.includeOpenOrders) {
        try {
          const openOrders = await api.getOpenOrdersAsync(username);
          for (const order of openOrders) {
            if (order.sell_price.base.indexOf('SBD') !== -1) {
              sbdOrders += order.for_sale;
            } else if (order.sell_price.base.indexOf('STEEM') !== -1) {
              steemOrders += order.for_sale;
            }
          }
          steemOrders /= assetPrecision;
          sbdOrders /= assetPrecision;
        } catch (err) {
          console.warn('getOpenOrders failed:', err);
        }
      }

      return {
        savingsPendingSteem,
        savingsPendingSbd,
        conversionTotalSbd,
        steemOrders,
        sbdOrders,
        conversions,
        savingsWithdrawals,
      };
    }).catch((error) => {
      console.error('Error fetching wallet estimate extras:', error);
      throw new Error(`Failed to fetch wallet estimate extras: ${(error as Error).message}`);
    });
  }

  /**
   * Get outgoing vesting delegations (condenser_api.get_vesting_delegations).
   * Recursively pages until all delegations are fetched (max 5000).
   */
  static async getVestingDelegations(
    account: string,
    options: { maxItems?: number } = {}
  ): Promise<VestingDelegation[]> {
    const maxItems = options.maxItems ?? 5000;
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown[]) => Promise<unknown>;
      };
      const all: VestingDelegation[] = [];
      let start = '';
      const limit = 1000;
      let delay = 250;
      while (true) {
        const batch = (await api.callAsync('condenser_api.get_vesting_delegations', [
          account,
          start,
          limit,
        ])) as VestingDelegation[];
        if (!Array.isArray(batch) || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < limit || all.length >= maxItems) break;
        start = batch[batch.length - 1]!.delegatee;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.2, 3000);
      }
      return all;
    }).catch((error) => {
      console.error('Error fetching vesting delegations:', error);
      throw new Error(`Failed to fetch vesting delegations: ${(error as Error).message}`);
    });
  }

  /**
   * Get expiring vesting delegation objects (database_api.find_vesting_delegation_expirations).
   */
  static async getExpiringVestingDelegations(
    account: string
  ): Promise<ExpiringVestingDelegation[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };
      const result = (await api.callAsync(
        'database_api.find_vesting_delegation_expirations',
        { account }
      )) as { delegations?: ExpiringVestingDelegation[] } | null;
      if (!result || !Array.isArray(result.delegations)) return [];
      return result.delegations.map((d) => ({
        id: d.id,
        delegator: d.delegator,
        delegatee: d.delegatee,
        vesting_shares: d.vesting_shares,
        expiration: d.expiration,
      }));
    }).catch((error) => {
      console.error('Error fetching expiring vesting delegations:', error);
      throw new Error(
        `Failed to fetch expiring vesting delegations: ${(error as Error).message}`
      );
    });
  }

  /**
   * Request account recovery via Conveyor (kingdom.recovery_account).
   * Broadcasts a `request_account_recovery` operation signed by the
   * recovery account's posting key.  This must happen **before** the
   * client submits the `recover_account` operation.
   *
   * Requires CONVEYOR_USERNAME and CONVEYOR_POSTING_WIF env vars.
   */
  static async requestAccountRecovery(payload: {
    account_to_recover: string;
    new_owner_authority: {
      weight_threshold: number;
      account_auths: [string, number][];
      key_auths: [string, number][];
    };
  }): Promise<void> {
    const conveyorUsername = process.env.CONVEYOR_USERNAME;
    const conveyorWif = process.env.CONVEYOR_POSTING_WIF;

    if (!conveyorUsername || !conveyorWif) {
      throw new Error(
        'CONVEYOR_USERNAME / CONVEYOR_POSTING_WIF not configured'
      );
    }

    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        signedCallAsync?: (
          method: string,
          params: unknown[],
          account: string,
          key: string
        ) => Promise<unknown>;
      };
      if (typeof api.signedCallAsync !== 'function') {
        throw new Error('steem.api.signedCallAsync is not available');
      }
      await api.signedCallAsync(
        'kingdom.recovery_account',
        payload as unknown as unknown[],
        conveyorUsername,
        conveyorWif
      );
    }) as Promise<void>;
  }

  /**
   * Validate the CONVEYOR recovery-signing configuration (high-value secret).
   *
   * CONVEYOR_POSTING_WIF signs on-chain `request_account_recovery`, so a
   * compromise grants the recovery account's posting authority and enables
   * abuse of the account-recovery workflow. This must be treated as a
   * high-value secret: restrict deploy access, rotate on suspected compromise,
   * and (ideally) move signing behind an external signer / HSM.
   *
   * Returns an error string when misconfigured (missing vars, or the WIF does
   * not look like a valid Steem private key), or null when OK. Safe to call at
   * any time; used as a preflight by recovery/confirm before broadcasting.
   */
  static validateConveyorConfig(): string | null {
    const username = process.env.CONVEYOR_USERNAME;
    const wif = process.env.CONVEYOR_POSTING_WIF;
    if (!username || !wif) {
      return 'Recovery service not configured (CONVEYOR_USERNAME / CONVEYOR_POSTING_WIF missing)';
    }
    // Steem WIFs are base58 strings starting with '5' (51 chars for mainnet).
    // Validate format only — never log the value itself.
    if (!/^5[HJ][1-9A-HJ-NP-Za-km-z]{49}$/.test(wif)) {
      return 'CONVEYOR_POSTING_WIF is not a valid Steem private key format';
    }
    return null;
  }

  /**
   * Broadcast a signed transaction
   */
  static async broadcastTransaction(signedTx: SignedTransaction): Promise<BroadcastResult> {
    const op0 = signedTx.operations?.[0];
    let txForBroadcast = signedTx;
    if (Array.isArray(op0) && op0.length === 2 && op0[0] === 'account_update') {
      txForBroadcast = steem.auth.normalizeTransactionForBroadcast(
        signedTx as unknown as Record<string, unknown>
      ) as unknown as SignedTransaction;
    }

    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync?: (method: string, params: unknown[]) => Promise<unknown>;
      };
      if (typeof api.callAsync !== 'function') {
        throw new Error('Steem API callAsync is not available');
      }
      // condenser_api legacy JSON (tuple key_auths). steem.api.broadcastTransactionAsync
      // hits network_broadcast_api and fails with bad_cast on steemitdev.
      const result = await api.callAsync('condenser_api.broadcast_transaction', [txForBroadcast]);
      return result as BroadcastResult;
    }).catch((error) => {
      console.error('Error broadcasting transaction:', error);
      throw new Error(`Failed to broadcast: ${(error as Error).message}`);
    });
  }

  /**
   * Validate the structural shape of a signed transaction.
   *
   * This checks only that the transaction has the fields a validly-signed
   * transaction requires (signatures present, finite ref_block_num /
   * ref_block_prefix, non-empty expiration, non-empty operations). It does
   * NOT perform cryptographic signature verification — the relay deliberately
   * does not verify transaction contents; the Steem chain is the authority.
   */
  static validateTransactionShape(signedTx: SignedTransaction): boolean {
    try {
      // Basic validation
      if (!signedTx.signatures || signedTx.signatures.length === 0) {
        return false;
      }

      // Numeric refs must be finite numbers — do NOT use truthiness: ref_block_num is
      // `head_block_number & 0xffff` and is legitimately 0 every 65536 blocks.
      const refNumOk =
        typeof signedTx.ref_block_num === 'number' && Number.isFinite(signedTx.ref_block_num);
      const refPrefixOk =
        typeof signedTx.ref_block_prefix === 'number' &&
        Number.isFinite(signedTx.ref_block_prefix);

      if (
        !refNumOk ||
        !refPrefixOk ||
        typeof signedTx.expiration !== 'string' ||
        signedTx.expiration.length === 0 ||
        !Array.isArray(signedTx.operations) ||
        signedTx.operations.length === 0
      ) {
        return false;
      }

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
    // Use a cryptographically strong random rather than Math.random so the
    // challenge cannot be predicted (it gates login signature verification).
    const random = randomBytes(16).toString('hex');
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

  static async getMarketOrderBook(): Promise<{ bids: MarketOrderRow[]; asks: MarketOrderRow[] }> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getOrderBookAsync: (limit: number) => Promise<{
          bids?: unknown[];
          asks?: unknown[];
        }>;
      };
      const raw = await api.getOrderBookAsync(ORDERBOOK_LIMIT);
      return parseOrderBook({
        bids: (raw.bids ?? []) as RawOrderBookEntry[],
        asks: (raw.asks ?? []) as RawOrderBookEntry[],
      });
    });
  }

  static async getMarketTicker(): Promise<MarketTicker> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getTickerAsync: () => Promise<Record<string, unknown>>;
      };
      const raw = await api.getTickerAsync();
      return parseTicker(raw);
    });
  }

  static async getMarketRecentTrades(limit = RECENT_TRADES_LIMIT): Promise<MarketTradeRow[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getRecentTradesAsync: (n: number) => Promise<unknown[]>;
      };
      const raw = await api.getRecentTradesAsync(limit);
      return (raw ?? [])
        .map((t) => parseTradeFill(t as Record<string, unknown>))
        .filter((t): t is MarketTradeRow => t !== null);
    });
  }

  static async getMarketTradeHistorySince(sinceIso: string): Promise<MarketTradeRow[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getTradeHistoryAsync: (start: string, end: string, limit: number) => Promise<unknown[]>;
      };
      const start = sinceIso.replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
      const raw = await api.getTradeHistoryAsync(start, '1969-12-31T23:59:59', 1000);
      return (raw ?? [])
        .map((t) => parseTradeFill(t as Record<string, unknown>))
        .filter((t): t is MarketTradeRow => t !== null)
        .reverse();
    });
  }

  static async getMarketOpenOrders(username: string): Promise<MarketOpenOrderRow[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        getOpenOrdersAsync: (owner: string) => Promise<
          {
            orderid: number;
            created: string;
            sell_price: { base: string; quote: string };
            for_sale?: number;
          }[]
        >;
      };
      const raw = await api.getOpenOrdersAsync(username);
      return (raw ?? []).map(parseOpenOrder);
    });
  }

  static async listProposals(params: {
    start: unknown[];
    limit: number;
    order: ProposalOrderBy;
    order_direction: ProposalOrderDirection;
    status: ProposalStatus;
  }): Promise<Proposal[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };
      const result = (await api.callAsync('database_api.list_proposals', {
        start: params.start,
        limit: params.limit,
        order: params.order,
        order_direction: params.order_direction,
        status: params.status,
      })) as { proposals?: unknown[] } | null;
      if (!result || !Array.isArray(result.proposals)) return [];
      return result.proposals as Proposal[];
    }).catch((error) => {
      console.error('Error fetching proposals:', error);
      throw new Error(`Failed to fetch proposals: ${(error as Error).message}`);
    });
  }

  static async getChainConfig(): Promise<Record<string, unknown>> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };
      const result = await api.callAsync('database_api.get_config', {});
      return (result ?? {}) as Record<string, unknown>;
    }).catch((error) => {
      console.error('Error fetching chain config:', error);
      throw new Error(`Failed to fetch chain config: ${(error as Error).message}`);
    });
  }

  static async listProposalVotesByProposal(
    proposalId: number,
    options?: { lastVoter?: string; limit?: number }
  ): Promise<{ voter: string; proposal: { proposal_id: number } }[]> {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };
      const lastVoter = options?.lastVoter ?? '';
      const limit = options?.limit ?? 1000;
      const result = (await api.callAsync('database_api.list_proposal_votes', {
        start: [proposalId, lastVoter],
        limit,
        order: 'by_proposal_voter',
        order_direction: 'ascending',
        status: 'active',
      })) as { proposal_votes?: unknown[] } | null;
      if (!result || !Array.isArray(result.proposal_votes)) return [];
      return result.proposal_votes as { voter: string; proposal: { proposal_id: number } }[];
    }).catch((error) => {
      console.error('Error fetching proposal votes by proposal:', error);
      throw new Error(`Failed to fetch proposal votes: ${(error as Error).message}`);
    });
  }

  static async listProposalVotesByVoter(voter: string): Promise<
    {
      voter: string;
      proposal: { proposal_id: number };
    }[]
  > {
    return withFailover(async () => {
      ensureConfigured();
      const api = steem.api as unknown as {
        callAsync: (method: string, params: unknown) => Promise<unknown>;
      };
      const result = (await api.callAsync('database_api.list_proposal_votes', {
        start: [voter],
        limit: 1000,
        order: 'by_voter_proposal',
        order_direction: 'ascending',
        status: 'all',
      })) as { proposal_votes?: unknown[] } | null;
      if (!result || !Array.isArray(result.proposal_votes)) return [];
      return result.proposal_votes as { voter: string; proposal: { proposal_id: number } }[];
    }).catch((error) => {
      console.error('Error fetching proposal votes:', error);
      throw new Error(`Failed to fetch proposal votes: ${(error as Error).message}`);
    });
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
