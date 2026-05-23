/**
 * Steem client module unit tests.
 *
 * For SteemSigner we only assert what the module itself produces — the operations
 * array passed to `steem.auth.signTransaction` — instead of inspecting the mock's
 * return value (which would just be the mock echoing itself).
 *
 * For apiClient we drive every broadcast/query through a single it.each table so
 * each call's URL, method, headers (CSRF), and body are verified consistently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignedTransaction } from '@/lib/steem/types';
import { steem } from '@steemit/steem-js';
import { apiClient, SteemSigner } from '@/lib/steem/client';

global.fetch = vi.fn();

const mockTx: SignedTransaction = {
  ref_block_num: 1,
  ref_block_prefix: 1,
  expiration: '2020-01-01T00:00:00',
  operations: [],
  extensions: [],
  signatures: ['SIG123'],
};

function setCSRFCookie(token: string | null) {
  Object.defineProperty(global, 'document', {
    value: { cookie: token ? `csrf_token=${token}` : '' },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCSRFCookie('test-token');
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/query/transaction-header')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          ref_block_num: 99,
          ref_block_prefix: 3704360964,
          expiration: '2030-01-01T12:00:00.123',
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ success: true }),
    });
  });
});

describe('SteemSigner.signXxx — produces the expected operations payload', () => {
  it.each<{
    name: string;
    call: () => Promise<unknown>;
    operations: unknown[];
    keys: string[];
  }>([
    {
      name: 'signTransfer',
      call: () => SteemSigner.signTransfer('alice', 'bob', '1.000 STEEM', 'note', '5Jactive'),
      operations: [
        ['transfer', { from: 'alice', to: 'bob', amount: '1.000 STEEM', memo: 'note' }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signTransferToSavings (memo defaults to empty)',
      call: () =>
        SteemSigner.signTransferToSavings('alice', 'alice', '1.000 STEEM', '', '5Jactive'),
      operations: [
        ['transfer_to_savings', { from: 'alice', to: 'alice', amount: '1.000 STEEM', memo: '' }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signTransferFromSavings (carries request_id)',
      call: () =>
        SteemSigner.signTransferFromSavings(
          'alice',
          'alice',
          '1.000 STEEM',
          'm',
          42,
          '5Jactive',
        ),
      operations: [
        [
          'transfer_from_savings',
          {
            from: 'alice',
            to: 'alice',
            amount: '1.000 STEEM',
            memo: 'm',
            request_id: 42,
          },
        ],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signTransferToVesting (power up)',
      call: () =>
        SteemSigner.signTransferToVesting('alice', 'alice', '5.000 STEEM', '5Jactive'),
      operations: [
        ['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '5.000 STEEM' }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signPowerDown',
      call: () => SteemSigner.signPowerDown('alice', '100.000000 VESTS', '5Jactive'),
      operations: [
        ['withdraw_vesting', { account: 'alice', vesting_shares: '100.000000 VESTS' }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signDelegate',
      call: () => SteemSigner.signDelegate('alice', 'bob', '100.000000 VESTS', '5Jactive'),
      operations: [
        [
          'delegate_vesting_shares',
          { delegator: 'alice', delegatee: 'bob', vesting_shares: '100.000000 VESTS' },
        ],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signVote (uses posting key)',
      call: () => SteemSigner.signVote('voter', 'author', 'permlink', 10000, '5Jposting'),
      operations: [
        ['vote', { voter: 'voter', author: 'author', permlink: 'permlink', weight: 10000 }],
      ],
      keys: ['5Jposting'],
    },
    {
      name: 'signWitnessVote',
      call: () => SteemSigner.signWitnessVote('alice', 'witness1', true, '5Jactive'),
      operations: [
        ['account_witness_vote', { account: 'alice', witness: 'witness1', approve: true }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signSetWithdrawVestingRoute',
      call: () =>
        SteemSigner.signSetWithdrawVestingRoute('alice', 'bob', 5000, true, '5Jactive'),
      operations: [
        [
          'set_withdraw_vesting_route',
          { from_account: 'alice', to_account: 'bob', percent: 5000, auto_vest: true },
        ],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signConvert',
      call: () => SteemSigner.signConvert('alice', 1710000000, '10.500 SBD', '5Jactive'),
      operations: [
        ['convert', { owner: 'alice', requestid: 1710000000, amount: '10.500 SBD' }],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signAccountCreate',
      call: () =>
        SteemSigner.signAccountCreate('alice', 'hive-123456', 'Psecret', '5Jactive'),
      operations: [
        [
          'account_create',
          expect.objectContaining({
            fee: '3.000 STEEM',
            creator: 'alice',
            new_account_name: 'hive-123456',
          }),
        ],
      ],
      keys: ['5Jactive'],
    },
    {
      name: 'signOperations',
      call: () =>
        SteemSigner.signOperations(
          [['custom_json', { required_posting_auths: ['alice'], id: 'community', json: '[]' }]],
          ['5Jposting']
        ),
      operations: [
        ['custom_json', { required_posting_auths: ['alice'], id: 'community', json: '[]' }],
      ],
      keys: ['5Jposting'],
    },
    {
      name: 'signAccountUpdate',
      call: () =>
        SteemSigner.signAccountUpdate(
          [
            'account_update',
            {
              account: 'alice',
              owner: { weight_threshold: 1, account_auths: [], key_auths: [['STMowner', 1]] },
              active: { weight_threshold: 1, account_auths: [], key_auths: [['STMactive', 1]] },
              posting: { weight_threshold: 1, account_auths: [], key_auths: [['STMpost', 1]] },
              memo_key: 'STMmemo',
              json_metadata: '{}',
            },
          ],
          '5Jowner'
        ),
      operations: [
        [
          'account_update',
          {
            account: 'alice',
            owner: { weight_threshold: 1, account_auths: [], key_auths: [['STMowner', 1]] },
            active: { weight_threshold: 1, account_auths: [], key_auths: [['STMactive', 1]] },
            posting: { weight_threshold: 1, account_auths: [], key_auths: [['STMpost', 1]] },
            memo_key: 'STMmemo',
            json_metadata: '{}',
          },
        ],
      ],
      keys: ['5Jowner'],
    },
  ])('$name', async ({ call, operations, keys }) => {
    await call();
    const calls = vi.mocked(steem.auth.signTransaction).mock.calls;
    const [tx, signingKeys] = calls[calls.length - 1]!;
    expect((tx as { operations: unknown[] }).operations).toEqual(operations);
    expect((tx as { ref_block_num: number }).ref_block_num).toBe(99);
    expect(signingKeys).toEqual(keys);
  });
});

describe('SteemSigner.generateChallenge', () => {
  it('returns a unique <timestamp>-<random> string', () => {
    const a = SteemSigner.generateChallenge();
    const b = SteemSigner.generateChallenge();
    expect(a).toMatch(/^\d+-[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe('apiClient.getChallenge', () => {
  it('GETs /api/auth/challenge with the encoded username', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ challenge: 'login-test-123' }),
    });
    const result = await apiClient.getChallenge('alice/bob');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/challenge?username=alice%2Fbob',
    );
    expect(result).toEqual({ challenge: 'login-test-123' });
  });

  it('throws on a non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false });
    await expect(apiClient.getChallenge('alice')).rejects.toThrow('Failed to get challenge');
  });
});

describe('apiClient.login / logout — CSRF header propagation', () => {
  it('login posts credentials and forwards csrf_token cookie as X-CSRF-Token', async () => {
    await apiClient.login('alice', 'signed-challenge', 'STM123');
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-token',
      },
      body: JSON.stringify({
        username: 'alice',
        signedChallenge: 'signed-challenge',
        publicKey: 'STM123',
      }),
    });
  });

  it('logout omits the CSRF header when no csrf_token cookie is set', async () => {
    setCSRFCookie(null);
    await apiClient.logout();
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: {},
    });
  });
});

describe('apiClient broadcasts — every method posts the signed tx to its endpoint', () => {
  it.each<{
    name: string;
    endpoint: string;
    call: () => Promise<unknown>;
  }>([
    {
      name: 'broadcastTransfer',
      endpoint: '/api/broadcast/transfer',
      call: () => apiClient.broadcastTransfer(mockTx, 'alice'),
    },
    {
      name: 'broadcastPowerDown',
      endpoint: '/api/broadcast/power-down',
      call: () => apiClient.broadcastPowerDown(mockTx, 'alice'),
    },
    {
      name: 'broadcastDelegate',
      endpoint: '/api/broadcast/delegate',
      call: () => apiClient.broadcastDelegate(mockTx, 'alice'),
    },
    {
      name: 'broadcastVote',
      endpoint: '/api/broadcast/vote',
      call: () => apiClient.broadcastVote(mockTx, 'alice'),
    },
    {
      name: 'broadcastWitnessVote',
      endpoint: '/api/broadcast/witness-vote',
      call: () => apiClient.broadcastWitnessVote(mockTx, 'alice'),
    },
    {
      name: 'broadcastSetWithdrawVestingRoute',
      endpoint: '/api/broadcast/set-withdraw-vesting-route',
      call: () => apiClient.broadcastSetWithdrawVestingRoute(mockTx, 'alice'),
    },
    {
      name: 'broadcastConvert',
      endpoint: '/api/broadcast/convert',
      call: () => apiClient.broadcastConvert(mockTx, 'alice'),
    },
    {
      name: 'broadcastAccountCreate',
      endpoint: '/api/broadcast/account-create',
      call: () => apiClient.broadcastAccountCreate(mockTx, 'alice'),
    },
    {
      name: 'broadcastCustomJson',
      endpoint: '/api/broadcast/custom-json',
      call: () => apiClient.broadcastCustomJson(mockTx, 'alice'),
    },
    {
      name: 'broadcastAccountUpdate',
      endpoint: '/api/broadcast/account-update',
      call: () => apiClient.broadcastAccountUpdate(mockTx, 'alice'),
    },
  ])('$name → POST $endpoint with CSRF + signedTx', async ({ endpoint, call }) => {
    await call();
    expect(global.fetch).toHaveBeenCalledWith(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-token',
      },
      body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
    });
  });
});

describe('apiClient queries — GET endpoints', () => {
  it.each<{
    name: string;
    call: () => Promise<unknown>;
    url: string;
  }>([
    {
      name: 'getAccounts',
      call: () => apiClient.getAccounts(['alice', 'bob']),
      url: '/api/query/accounts?names=alice,bob',
    },
    {
      name: 'getHistory (defaults to limit=50 caller arg)',
      call: () => apiClient.getHistory('alice', 50),
      url: '/api/query/history?username=alice&limit=50',
    },
    {
      name: 'getWitnesses',
      call: () => apiClient.getWitnesses(50),
      url: '/api/query/witnesses?limit=50',
    },
    {
      name: 'getGlobalProps',
      call: () => apiClient.getGlobalProps(),
      url: '/api/query/global-props',
    },
    {
      name: 'getTransactionHeader',
      call: () => apiClient.getTransactionHeader(),
      url: '/api/query/transaction-header',
    },
    {
      name: 'getWithdrawRoutes (encodes username)',
      call: () => apiClient.getWithdrawRoutes('alice/bob'),
      url: '/api/query/withdraw-routes?username=alice%2Fbob',
    },
    {
      name: 'getMedianHistoryPrice',
      call: () => apiClient.getMedianHistoryPrice(),
      url: '/api/query/median-history-price',
    },
  ])('$name → GET $url', async ({ call, url }) => {
    await call();
    expect(global.fetch).toHaveBeenCalledWith(url);
  });
});
