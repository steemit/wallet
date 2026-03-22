/**
 * Steem client module unit tests
 * Note: SteemSigner methods rely on @steemit/steem-js which is an external library.
 * We test the API client methods which can be properly mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignedTransaction } from '@/lib/steem/types';

// Mock fetch
global.fetch = vi.fn();

import { steem } from '@steemit/steem-js';
import { apiClient, SteemSigner } from '@/lib/steem/client';

describe('SteemSigner - Basic Structure', () => {
  // Just verify the class has the expected methods
  it('should have signTransfer method', () => {
    expect(SteemSigner.signTransfer).toBeInstanceOf(Function);
  });

  it('should have signPowerDown method', () => {
    expect(SteemSigner.signPowerDown).toBeInstanceOf(Function);
  });

  it('should have signDelegate method', () => {
    expect(SteemSigner.signDelegate).toBeInstanceOf(Function);
  });

  it('should have signWitnessVote method', () => {
    expect(SteemSigner.signWitnessVote).toBeInstanceOf(Function);
  });

  it('should have generateChallenge method', () => {
    expect(SteemSigner.generateChallenge).toBeInstanceOf(Function);
  });

  it('should generate a unique challenge string', () => {
    const challenge1 = SteemSigner.generateChallenge();
    const challenge2 = SteemSigner.generateChallenge();

    expect(challenge1).toMatch(/^\d+-[a-z0-9]+$/);
    expect(challenge2).toMatch(/^\d+-[a-z0-9]+$/);
    expect(challenge1).not.toBe(challenge2);
  });

  it('should sign transfer and return signed tx', () => {
    const signed = SteemSigner.signTransfer('alice', 'bob', '1.000 STEEM', 'memo', '5Jkey');
    expect(signed).toEqual(expect.objectContaining({ signatures: ['SIG'], operations: [] }));
  });

  it('should sign power down and return signed tx', () => {
    const signed = SteemSigner.signPowerDown('alice', '100.000000 VESTS', '5Jkey');
    expect(signed).toEqual(expect.objectContaining({ signatures: ['SIG'], operations: [] }));
  });

  it('should sign delegate and return signed tx', () => {
    const signed = SteemSigner.signDelegate('alice', 'bob', '100.000000 VESTS', '5Jkey');
    expect(signed).toEqual(expect.objectContaining({ signatures: ['SIG'], operations: [] }));
  });

  it('should sign vote and return signed tx', () => {
    const signed = SteemSigner.signVote('voter', 'author', 'permlink', 10000, '5Jkey');
    expect(signed).toEqual(expect.objectContaining({ signatures: ['SIG'], operations: [] }));
  });

  it('should sign witness vote and return signed tx', () => {
    const signed = SteemSigner.signWitnessVote('alice', 'witness1', true, '5Jkey');
    expect(signed).toEqual(expect.objectContaining({ signatures: ['SIG'], operations: [] }));
  });

  it('should return public key from private key', () => {
    const pub = SteemSigner.privateKeyToPublicKey('5Jkey');
    expect(pub).toBe('STM5Jkey');
  });

  it('should derive role key from password', () => {
    const wif = SteemSigner.derivePrivateKeyFromPassword('user', 'pass', 'active');
    expect(wif).toBe('5Jmock');
  });

  it('should return all role keys from master password', () => {
    const keys = SteemSigner.getPrivateKeysFromMasterPassword('user', 'pass');
    expect(keys).toMatchObject({ owner: '5Jo', active: '5Ja', posting: '5Jp', memo: '5Jm' });
  });

  it('should sign challenge', () => {
    const sig = SteemSigner.signChallenge('challenge', '5Jkey');
    expect(sig).toBe('signed');
  });

  it('should verify private key matches public key', () => {
    const ok = SteemSigner.verifyPrivateKey('5Jkey', 'STM5Jkey');
    expect(ok).toBe(true);
  });

  it('should validate WIF format', () => {
    expect(SteemSigner.isValidPrivateKey('5Jkey')).toBe(true);
  });

  it('should sign set_withdraw_vesting_route with expected operation payload', () => {
    vi.mocked(steem.auth.signTransaction).mockImplementationOnce(
      (tx: { operations: unknown[]; extensions: unknown[] }) =>
        ({ ...tx, signatures: ['SIG'] }) as SignedTransaction
    );
    const signed = SteemSigner.signSetWithdrawVestingRoute('alice', 'bob', 5000, true, '5Jkey');
    expect(signed.operations).toEqual([
      [
        'set_withdraw_vesting_route',
        { from_account: 'alice', to_account: 'bob', percent: 5000, auto_vest: true },
      ],
    ]);
  });

  it('should sign convert with expected operation payload', () => {
    vi.mocked(steem.auth.signTransaction).mockImplementationOnce(
      (tx: { operations: unknown[]; extensions: unknown[] }) =>
        ({ ...tx, signatures: ['SIG'] }) as SignedTransaction
    );
    const signed = SteemSigner.signConvert('alice', 1710000000, '10.500 SBD', '5Jkey');
    expect(signed.operations).toEqual([
      ['convert', { owner: 'alice', requestid: 1710000000, amount: '10.500 SBD' }],
    ]);
  });
});

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChallenge', () => {
    it('should fetch login challenge', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ challenge: 'login-test-123' }),
      });

      const result = await apiClient.getChallenge('alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/challenge?username=alice');
      expect(result).toEqual({ challenge: 'login-test-123' });
    });

    it('should throw on failed response', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

      await expect(apiClient.getChallenge('alice')).rejects.toThrow('Failed to get challenge');
    });
  });

  describe('login', () => {
    it('should send login request with CSRF header when cookie is present', async () => {
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.login('alice', 'signed-challenge', 'STM123');

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
      expect(result).toEqual({ success: true });
    });
  });

  describe('logout', () => {
    it('should send logout request with CSRF header when cookie is present', async () => {
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.logout();

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': 'test-token' },
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('broadcastTransfer', () => {
    it('should broadcast transfer transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, result: { id: 'tx123' } }),
      });

      const result = await apiClient.broadcastTransfer(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastPowerDown', () => {
    it('should broadcast power down transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastPowerDown(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/power-down', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastDelegate', () => {
    it('should broadcast delegate transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastDelegate(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/delegate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastVote', () => {
    it('should broadcast vote transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastVote(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastWitnessVote', () => {
    it('should broadcast witness vote transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastWitnessVote(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/witness-vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getAccounts', () => {
    it('should fetch account information', async () => {
      const mockAccounts = [
        { name: 'alice', balance: '1000.000 STEEM' },
        { name: 'bob', balance: '500.000 STEEM' },
      ];
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ accounts: mockAccounts }),
      });

      const result = await apiClient.getAccounts(['alice', 'bob']);

      expect(global.fetch).toHaveBeenCalledWith('/api/query/accounts?names=alice,bob');
      expect(result.accounts).toEqual(mockAccounts);
    });
  });

  describe('getHistory', () => {
    it('should fetch account history', async () => {
      const mockHistory = [['1', { type: 'transfer' }]];
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ history: mockHistory }),
      });

      const result = await apiClient.getHistory('alice', 50);

      expect(global.fetch).toHaveBeenCalledWith('/api/query/history?username=alice&limit=50');
      expect(result.history).toEqual(mockHistory);
    });
  });

  describe('getWitnesses', () => {
    it('should fetch witnesses list', async () => {
      const mockWitnesses = [
        { owner: 'witness1', votes: '1000000' },
        { owner: 'witness2', votes: '900000' },
      ];
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ witnesses: mockWitnesses }),
      });

      const result = await apiClient.getWitnesses(50);

      expect(global.fetch).toHaveBeenCalledWith('/api/query/witnesses?limit=50');
      expect(result.witnesses).toEqual(mockWitnesses);
    });
  });

  describe('getGlobalProps', () => {
    it('should fetch global properties', async () => {
      const mockProps = { head_block_number: 12345, total_vesting_shares: '1000000' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ props: mockProps }),
      });

      const result = await apiClient.getGlobalProps();

      expect(global.fetch).toHaveBeenCalledWith('/api/query/global-props');
      expect(result.props).toEqual(mockProps);
    });
  });

  describe('getWithdrawRoutes', () => {
    it('should fetch outgoing withdraw routes', async () => {
      const mockRoutes = [{ to_account: 'bob', percent: 2500, auto_vest: false }];
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ routes: mockRoutes }),
      });

      const result = await apiClient.getWithdrawRoutes('alice');

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/query/withdraw-routes?username=${encodeURIComponent('alice')}`
      );
      expect(result.routes).toEqual(mockRoutes);
    });
  });

  describe('getMedianHistoryPrice', () => {
    it('should fetch median history price', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ base: '1.234 SBD', quote: '5.000 STEEM' }),
      });

      const result = await apiClient.getMedianHistoryPrice();

      expect(global.fetch).toHaveBeenCalledWith('/api/query/median-history-price');
      expect(result.base).toBe('1.234 SBD');
      expect(result.quote).toBe('5.000 STEEM');
    });
  });

  describe('broadcastSetWithdrawVestingRoute', () => {
    it('should POST signed route transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastSetWithdrawVestingRoute(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/set-withdraw-vesting-route', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastConvert', () => {
    it('should POST signed convert transaction with CSRF header', async () => {
      const mockTx: SignedTransaction = {
        ref_block_num: 1,
        ref_block_prefix: 1,
        expiration: '2020-01-01T00:00:00',
        operations: [],
        extensions: [],
        signatures: ['SIG123'],
      };
      Object.defineProperty(global, 'document', {
        value: { cookie: 'csrf_token=test-token' },
        configurable: true,
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastConvert(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'test-token',
        },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });
});
