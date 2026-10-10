/**
 * Steem Keychain browser-extension bridge — promisification of the
 * callback-based `window.steem_keychain` API.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  isKeychainInstalled,
  keychainSignBuffer,
  keychainSignTx,
} from '@/lib/steem/keychain';
import type { Operation } from '@/lib/steem/types';

afterEach(() => {
  delete (window as { steem_keychain?: unknown }).steem_keychain;
});

describe('isKeychainInstalled', () => {
  it('is false when window.steem_keychain is absent', () => {
    expect(isKeychainInstalled()).toBe(false);
  });

  it('is true once the extension injects window.steem_keychain', () => {
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {};
    expect(isKeychainInstalled()).toBe(true);
  });
});

describe('keychainSignBuffer', () => {
  it('rejects immediately when the extension is not installed', async () => {
    await expect(keychainSignBuffer('alice', 'challenge', 'Posting')).rejects.toThrow(
      'Steem Keychain is not installed'
    );
  });

  it('resolves with the signature and public key on success', async () => {
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {
      requestSignBuffer: (
        username: string,
        message: string,
        role: string,
        callback: (r: unknown) => void
      ) => {
        expect(username).toBe('alice');
        expect(message).toBe('challenge');
        expect(role).toBe('Posting');
        callback({ success: true, result: 'SIG123', publicKey: 'STM6Pub' });
      },
    };

    const result = await keychainSignBuffer('alice', 'challenge', 'Posting');
    expect(result).toEqual({ publicKey: 'STM6Pub', signature: 'SIG123' });
  });

  it('rejects with the extension message on failure', async () => {
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {
      requestSignBuffer: (
        _u: string,
        _m: string,
        _r: string,
        callback: (r: unknown) => void
      ) => {
        callback({ success: false, message: 'User cancelled' });
      },
    };

    await expect(keychainSignBuffer('alice', 'challenge', 'Posting')).rejects.toThrow(
      'User cancelled'
    );
  });

  it('rejects when the extension throws synchronously', async () => {
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {
      requestSignBuffer: () => {
        throw new Error('boom');
      },
    };

    await expect(keychainSignBuffer('alice', 'challenge', 'Posting')).rejects.toThrow('boom');
  });
});

describe('keychainSignTx', () => {
  const tx = {
    ref_block_num: 1,
    ref_block_prefix: 2,
    expiration: '2026-01-01T00:00:00',
    operations: [['claim_reward_balance', { account: 'alice' }]] as Operation[],
    extensions: [] as unknown[],
  };

  it('rejects immediately when the extension is not installed', async () => {
    await expect(keychainSignTx('alice', tx, 'Posting')).rejects.toThrow(
      'Steem Keychain is not installed'
    );
  });

  it('resolves with the signed transaction unchanged on success', async () => {
    const signedTx = { ...tx, signatures: ['SIG'] };
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {
      requestSignTx: (
        username: string,
        requestedTx: unknown,
        role: string,
        callback: (r: unknown) => void
      ) => {
        expect(username).toBe('alice');
        expect(requestedTx).toBe(tx);
        expect(role).toBe('Posting');
        callback({ success: true, result: signedTx });
      },
    };

    const result = await keychainSignTx('alice', tx, 'Posting');
    expect(result).toBe(signedTx);
  });

  it('rejects with the extension error object message on failure', async () => {
    (window as unknown as { steem_keychain: unknown }).steem_keychain = {
      requestSignTx: (
        _u: string,
        _t: unknown,
        _r: string,
        callback: (r: unknown) => void
      ) => {
        callback({ success: false, error: { message: 'missing key' } });
      },
    };

    await expect(keychainSignTx('alice', tx, 'Active')).rejects.toThrow('missing key');
  });
});
