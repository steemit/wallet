/**
 * Steem client module unit tests
 * Note: SteemSigner methods rely on @steemit/steem-js which is an external library.
 * We test the API client methods which can be properly mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch
global.fetch = vi.fn();

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
    it('should send login request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.login('alice', 'signed-challenge', 'STM123');

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', signedChallenge: 'signed-challenge', publicKey: 'STM123' }),
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('logout', () => {
    it('should send logout request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.logout();

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
      expect(result).toEqual({ success: true });
    });
  });

  describe('broadcastTransfer', () => {
    it('should broadcast transfer transaction', async () => {
      const mockTx = { signatures: ['SIG123'] };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, result: { id: 'tx123' } }),
      });

      const result = await apiClient.broadcastTransfer(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastPowerDown', () => {
    it('should broadcast power down transaction', async () => {
      const mockTx = { signatures: ['SIG123'] };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastPowerDown(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/power-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastDelegate', () => {
    it('should broadcast delegate transaction', async () => {
      const mockTx = { signatures: ['SIG123'] };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastDelegate(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastVote', () => {
    it('should broadcast vote transaction', async () => {
      const mockTx = { signatures: ['SIG123'] };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastVote(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTx: mockTx, username: 'alice' }),
      });
      expect(result.success).toBe(true);
    });
  });

  describe('broadcastWitnessVote', () => {
    it('should broadcast witness vote transaction', async () => {
      const mockTx = { signatures: ['SIG123'] };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await apiClient.broadcastWitnessVote(mockTx, 'alice');

      expect(global.fetch).toHaveBeenCalledWith('/api/broadcast/witness-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
});
