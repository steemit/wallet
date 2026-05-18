/**
 * Server-side Steem service unit tests.
 *
 * Three categories of behavior matter here:
 *   1. Pure helpers (generateChallenge, getKeyType, verifySignature shape check) —
 *      no I/O, easy boundary tests.
 *   2. Calculation-heavy methods (getWalletPrices, getWalletEstimateExtras) —
 *      assert the math on top of mocked node responses, since this is where
 *      regressions silently corrupt user-visible balances.
 *   3. withFailover — pin down the multi-URL fallback contract on top of
 *      `STEEM_RPC_URL=a,b` (requires resetModules + stubEnv because the URL
 *      list is read once at module load time).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { steem } from '@steemit/steem-js';
import { SteemService, checkSteemNodeHealth } from '@/lib/steem/server';
import type { SignedTransaction } from '@/lib/steem/types';

// Typed accessors so call sites stay readable. Runtime is just the mock object,
// but listing each method explicitly keeps `noUncheckedIndexedAccess` happy
// (a Record<string, …> index would return `Mock | undefined`).
type Mock = ReturnType<typeof vi.fn>;
interface MockApi {
  setOptions: Mock;
  getAccountsAsync: Mock;
  getAccountHistoryAsync: Mock;
  getWitnessesByVoteAsync: Mock;
  getWitnessByAccountAsync: Mock;
  getDynamicGlobalPropertiesAsync: Mock;
  getFeedHistoryAsync: Mock;
  broadcastTransactionAsync: Mock;
  callAsync: Mock;
  getSavingsWithdrawToAsync: Mock;
  getSavingsWithdrawFromAsync: Mock;
  getOpenOrdersAsync: Mock;
}
const api = steem.api as unknown as MockApi;
const authMock = steem.auth as unknown as { verifySignature: Mock };

beforeEach(() => {
  vi.clearAllMocks();
  // server.ts writes to console.{error,warn} on every error path; silence them
  // so test output stays useful.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- Pure helpers ----------

describe('SteemService.generateChallenge', () => {
  it('formats as login-<username>-<timestamp>-<random>', () => {
    expect(SteemService.generateChallenge('alice')).toMatch(/^login-alice-\d+-[a-z0-9]+$/);
  });

  it('produces a unique value per call', () => {
    const a = SteemService.generateChallenge('alice');
    const b = SteemService.generateChallenge('alice');
    expect(a).not.toBe(b);
  });
});

describe('SteemService.getKeyType', () => {
  it.each<{ input: string; expected: 'active' | null }>([
    { input: 'STM5abcdef', expected: 'active' },
    { input: 'TST5abcdef', expected: 'active' },
    { input: 'abc',        expected: null },
    { input: 'SBD5abcdef', expected: null },
    { input: '',           expected: null },
  ])('"$input" → $expected', ({ input, expected }) => {
    expect(SteemService.getKeyType(input)).toBe(expected);
  });
});

describe('SteemService.verifySignature (shape check only)', () => {
  const validTx: SignedTransaction = {
    ref_block_num: 1,
    ref_block_prefix: 1,
    expiration: '2020-01-01T00:00:00',
    operations: [['transfer', { from: 'a', to: 'b', amount: '1.000 STEEM', memo: '' }]],
    extensions: [],
    signatures: ['SIG123'],
  };

  it('accepts a tx with signatures + required fields + at least one op', async () => {
    expect(await SteemService.verifySignature(validTx)).toBe(true);
  });

  it.each<{ label: string; tx: SignedTransaction }>([
    { label: 'no signatures',    tx: { ...validTx, signatures: [] } },
    { label: 'no operations',    tx: { ...validTx, operations: [] } },
    { label: 'empty expiration', tx: { ...validTx, expiration: '' } },
  ])('rejects: $label', async ({ tx }) => {
    expect(await SteemService.verifySignature(tx)).toBe(false);
  });
});

describe('SteemService.verifyChallengeSignature', () => {
  it('forwards the result from steem.auth.verifySignature', () => {
    authMock.verifySignature.mockReturnValueOnce(true);
    expect(SteemService.verifyChallengeSignature('c', 'sig', 'STMpub')).toBe(true);
  });

  it('returns false when verifySignature throws', () => {
    authMock.verifySignature.mockImplementationOnce(() => {
      throw new Error('crypto error');
    });
    expect(SteemService.verifyChallengeSignature('c', 'sig', 'STMpub')).toBe(false);
  });
});

// ---------- Single-URL network methods ----------

describe('SteemService.getAccounts', () => {
  it('configures the RPC URL and returns the node response', async () => {
    api.getAccountsAsync.mockResolvedValueOnce([{ name: 'alice' }]);
    const result = await SteemService.getAccounts(['alice']);
    expect(result).toEqual([{ name: 'alice' }]);
    expect(api.setOptions).toHaveBeenCalledWith({ url: 'https://api.steemit.com' });
  });

  it('wraps node errors with "Failed to fetch accounts: <message>"', async () => {
    api.getAccountsAsync.mockRejectedValueOnce(new Error('Network'));
    await expect(SteemService.getAccounts(['alice'])).rejects.toThrow(
      'Failed to fetch accounts: Network',
    );
  });
});

describe('SteemService.broadcastTransaction', () => {
  const validTx: SignedTransaction = {
    ref_block_num: 1,
    ref_block_prefix: 1,
    expiration: 'x',
    operations: [['transfer', {}]],
    extensions: [],
    signatures: ['SIG'],
  };

  it('returns the broadcast result on success', async () => {
    api.broadcastTransactionAsync.mockResolvedValueOnce({ id: 'tx123' });
    expect(await SteemService.broadcastTransaction(validTx)).toEqual({ id: 'tx123' });
  });

  it('wraps errors with "Failed to broadcast: <message>"', async () => {
    api.broadcastTransactionAsync.mockRejectedValueOnce(new Error('bad'));
    await expect(SteemService.broadcastTransaction(validTx)).rejects.toThrow(
      'Failed to broadcast: bad',
    );
  });
});

describe('SteemService.getCurrentMedianHistoryPrice', () => {
  it('returns base/quote verbatim when the node provides strings', async () => {
    api.callAsync.mockResolvedValueOnce({ base: '1.234 SBD', quote: '5.000 STEEM' });
    expect(await SteemService.getCurrentMedianHistoryPrice()).toEqual({
      base: '1.234 SBD',
      quote: '5.000 STEEM',
    });
    expect(api.callAsync).toHaveBeenCalledWith(
      'condenser_api.get_current_median_history_price',
      [],
    );
  });

  it('defaults to "0 SBD" / "0 STEEM" when the response is missing fields', async () => {
    api.callAsync.mockResolvedValueOnce({});
    expect(await SteemService.getCurrentMedianHistoryPrice()).toEqual({
      base: '0 SBD',
      quote: '0 STEEM',
    });
  });
});

describe('SteemService.getWithdrawRoutesOutgoing', () => {
  it('normalizes both legacy ("to") and modern ("to_account") field names', async () => {
    api.callAsync.mockResolvedValueOnce([
      { to_account: 'modern', percent: 5000, auto_vest: true },
      { to: 'legacy',         percent: '2500', auto_vest: false }, // string → coerced
    ]);
    expect(await SteemService.getWithdrawRoutesOutgoing('alice')).toEqual([
      { to_account: 'modern', percent: 5000, auto_vest: true },
      { to_account: 'legacy', percent: 2500, auto_vest: false },
    ]);
  });

  it('returns [] when the node responds with a non-array', async () => {
    api.callAsync.mockResolvedValueOnce(null);
    expect(await SteemService.getWithdrawRoutesOutgoing('alice')).toEqual([]);
  });
});

// ---------- Wallet prices: feed history + market trades ----------

describe('SteemService.getWalletPrices', () => {
  it('derives steemPrice from the latest feed entry and sbdPrice from STEEM-leg trade extremes', async () => {
    // Latest feed: base 0.500 SBD per quote 1.000 STEEM  ⇒ steemPrice = 0.5
    api.getFeedHistoryAsync.mockResolvedValueOnce({
      price_history: [
        { base: '0.250 SBD', quote: '1.000 STEEM' }, // older, ignored
        { base: '0.500 SBD', quote: '1.000 STEEM' },
      ],
    });
    // nai @@000000021 = STEEM, @@000000013 = SBD.
    api.callAsync.mockResolvedValueOnce({
      trades: [
        // 2 STEEM ↔ 1 SBD  ⇒ sbd/steem = 0.5
        {
          current_pays: { amount: '2000', precision: 3, nai: '@@000000021' },
          open_pays:    { amount: '1000', precision: 3, nai: '@@000000013' },
        },
        // 4 STEEM ↔ 1 SBD  ⇒ sbd/steem = 0.25  → highest = 0.5, lowest = 0.25
        {
          current_pays: { amount: '4000', precision: 3, nai: '@@000000021' },
          open_pays:    { amount: '1000', precision: 3, nai: '@@000000013' },
        },
      ],
    });

    const { steemPrice, sbdPrice } = await SteemService.getWalletPrices();
    expect(steemPrice).toBeCloseTo(0.5, 6);
    // Formula: (1 / highest) * steemPrice = (1 / 0.5) * 0.5 = 1.0
    expect(sbdPrice).toBeCloseTo(1.0, 6);
  });

  it('zeros out both prices when feed and trades are empty', async () => {
    api.getFeedHistoryAsync.mockResolvedValueOnce({ price_history: [] });
    api.callAsync.mockResolvedValueOnce({ trades: [] });
    const { steemPrice, sbdPrice } = await SteemService.getWalletPrices();
    expect(steemPrice).toBe(0);
    expect(sbdPrice).toBe(0);
  });

  it('ignores trades that have no STEEM leg', async () => {
    api.getFeedHistoryAsync.mockResolvedValueOnce({
      price_history: [{ base: '0.500 SBD', quote: '1.000 STEEM' }],
    });
    api.callAsync.mockResolvedValueOnce({
      trades: [
        {
          current_pays: { amount: '1000', precision: 3, nai: '@@000000013' },
          open_pays:    { amount: '1000', precision: 3, nai: '@@000000013' },
        },
      ],
    });
    expect((await SteemService.getWalletPrices()).sbdPrice).toBe(0);
  });
});

// ---------- Wallet estimate extras: savings + conversions + open orders ----------

describe('SteemService.getWalletEstimateExtras', () => {
  it('deduplicates savings withdrawals by id and splits the totals by asset', async () => {
    api.getSavingsWithdrawToAsync.mockResolvedValueOnce([
      { id: 1, amount: '1.000 STEEM' },
      { id: 2, amount: '2.000 SBD' },
    ]);
    api.getSavingsWithdrawFromAsync.mockResolvedValueOnce([
      { id: 1, amount: '1.000 STEEM' }, // duplicate id → must not double-count
      { id: 3, amount: '5.000 STEEM' },
    ]);
    api.callAsync.mockResolvedValueOnce({ requests: [] });

    const extras = await SteemService.getWalletEstimateExtras('alice');
    expect(extras.savingsPendingSteem).toBe(6); // id 1 (1.0) + id 3 (5.0)
    expect(extras.savingsPendingSbd).toBe(2);   // id 2 (2.0)
  });

  it('only sums sbd conversions whose conversion_date is still in the future', async () => {
    api.getSavingsWithdrawToAsync.mockResolvedValueOnce([]);
    api.getSavingsWithdrawFromAsync.mockResolvedValueOnce([]);
    const strip = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '');
    const futureIso = strip(new Date(Date.now() + 24 * 3600 * 1000));
    const pastIso   = strip(new Date(Date.now() - 24 * 3600 * 1000));
    api.callAsync.mockResolvedValueOnce({
      requests: [
        { conversion_date: futureIso, amount: { amount: '1234', precision: 3 } },
        { conversion_date: pastIso,   amount: { amount: '9999', precision: 3 } }, // skipped
      ],
    });

    const { conversionTotalSbd } = await SteemService.getWalletEstimateExtras('alice');
    expect(conversionTotalSbd).toBeCloseTo(1.234, 6);
  });

  it('still returns the rest when find_sbd_conversion_requests fails', async () => {
    api.getSavingsWithdrawToAsync.mockResolvedValueOnce([{ id: 1, amount: '3.000 STEEM' }]);
    api.getSavingsWithdrawFromAsync.mockResolvedValueOnce([]);
    api.callAsync.mockRejectedValueOnce(new Error('node down'));

    const extras = await SteemService.getWalletEstimateExtras('alice');
    expect(extras.savingsPendingSteem).toBe(3);
    expect(extras.conversionTotalSbd).toBe(0);
  });

  it('skips open orders when includeOpenOrders is omitted, then sums and divides by 1000 when on', async () => {
    api.getSavingsWithdrawToAsync.mockResolvedValue([]);
    api.getSavingsWithdrawFromAsync.mockResolvedValue([]);
    api.callAsync.mockResolvedValue({ requests: [] });

    await SteemService.getWalletEstimateExtras('alice');
    expect(api.getOpenOrdersAsync).not.toHaveBeenCalled();

    api.getOpenOrdersAsync.mockResolvedValueOnce([
      { for_sale: 1500, sell_price: { base: '1.5 STEEM' } },
      { for_sale: 2000, sell_price: { base: '2 SBD' } },
    ]);
    const { steemOrders, sbdOrders } = await SteemService.getWalletEstimateExtras('alice', {
      includeOpenOrders: true,
    });
    // raw amounts are divided by assetPrecision=1000
    expect(steemOrders).toBeCloseTo(1.5, 6);
    expect(sbdOrders).toBeCloseTo(2.0, 6);
  });
});

// ---------- Health check ----------

describe('checkSteemNodeHealth', () => {
  it('returns healthy with block number and latency on success', async () => {
    api.getDynamicGlobalPropertiesAsync.mockResolvedValueOnce({
      head_block_number: 12345,
      head_block_id: 'block-id',
      time: '2020-01-01T00:00:00',
    });
    const health = await checkSteemNodeHealth();
    expect(health.healthy).toBe(true);
    expect(health.blockNumber).toBe(12345);
    expect(typeof health.latency).toBe('number');
  });

  it('returns unhealthy with error.message on failure', async () => {
    api.getDynamicGlobalPropertiesAsync.mockRejectedValue(new Error('down'));
    const health = await checkSteemNodeHealth();
    expect(health.healthy).toBe(false);
    expect(health.error).toContain('down');
  });
});

// ---------- Failover (multi-URL — must reset modules to pick up env) ----------

describe('withFailover (multi-URL)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls through to the next URL when the first one rejects', async () => {
    vi.resetModules();
    vi.stubEnv('STEEM_RPC_URL', 'https://node-a,https://node-b');
    const { SteemService: Service } = await import('@/lib/steem/server');
    const { steem: mockedSteem } = await import('@steemit/steem-js');

    vi.mocked(mockedSteem.api.getAccountsAsync)
      .mockRejectedValueOnce(new Error('A down'))
      .mockResolvedValueOnce([{ name: 'alice' }]);

    const result = await Service.getAccounts(['alice']);
    expect(result).toEqual([{ name: 'alice' }]);

    // setOptions fires both outside fn (in withFailover) and inside fn
    // (via ensureConfigured()), so we assert order via first-seen index
    // rather than expecting an exact two-element list.
    const urls = vi
      .mocked(mockedSteem.api.setOptions)
      .mock.calls.map((c) => (c[0] as { url: string }).url);
    expect(urls).toContain('https://node-a');
    expect(urls).toContain('https://node-b');
    expect(urls.indexOf('https://node-a')).toBeLessThan(urls.indexOf('https://node-b'));
  });

  it('throws the wrapped error from the last URL when every URL fails', async () => {
    vi.resetModules();
    vi.stubEnv('STEEM_RPC_URL', 'https://node-a,https://node-b');
    const { SteemService: Service } = await import('@/lib/steem/server');
    const { steem: mockedSteem } = await import('@steemit/steem-js');

    vi.mocked(mockedSteem.api.getAccountsAsync)
      .mockRejectedValueOnce(new Error('A down'))
      .mockRejectedValueOnce(new Error('B down'));

    await expect(Service.getAccounts(['alice'])).rejects.toThrow(
      'Failed to fetch accounts: B down',
    );
  });
});
