/**
 * SteemSigner.signTransaction — the single chokepoint that dispatches to
 * either raw-WIF local signing (unchanged) or the Steem Keychain browser
 * extension, based on the `SigningKey` passed in. See src/lib/steem/
 * signing-key.ts and src/lib/steem/keychain.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { steem } from '@steemit/steem-js';
import { SteemSigner } from '@/lib/steem/client';
import { wifKey, keychainKey } from '@/lib/steem/signing-key';

global.fetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as { steem_keychain?: unknown }).steem_keychain;
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    headers: new Headers(),
    json: async () => ({
      success: true,
      ref_block_num: 99,
      ref_block_prefix: 3704360964,
      expiration: '2030-01-01T12:00:00.123',
    }),
  });
});

describe('SteemSigner.signTransaction — raw WIF path (unchanged)', () => {
  it('signs locally via steem.auth.signTransaction for a plain string key', async () => {
    await SteemSigner.signTransaction([['transfer', { from: 'alice' }]], ['5Jactive']);
    expect(steem.auth.signTransaction).toHaveBeenCalledTimes(1);
    const [, keys] = vi.mocked(steem.auth.signTransaction).mock.calls[0]!;
    expect(keys).toEqual(['5Jactive']);
  });

  it('signs locally for an explicit wifKey() value', async () => {
    await SteemSigner.signTransaction([['transfer', { from: 'alice' }]], [wifKey('5Jactive')]);
    expect(steem.auth.signTransaction).toHaveBeenCalledTimes(1);
    const [, keys] = vi.mocked(steem.auth.signTransaction).mock.calls[0]!;
    expect(keys).toEqual(['5Jactive']);
  });

  it('still signs locally with multiple raw keys (e.g. recover_account)', async () => {
    await SteemSigner.signTransaction(
      [['recover_account', {}]],
      ['5JoldOwner', '5JnewOwner']
    );
    const [, keys] = vi.mocked(steem.auth.signTransaction).mock.calls[0]!;
    expect(keys).toEqual(['5JoldOwner', '5JnewOwner']);
  });
});

describe('SteemSigner.signTransaction — Keychain path', () => {
  it('dispatches to the Steem Keychain extension for a single keychain key, never touching steem.auth.signTransaction', async () => {
    const signedTx = {
      ref_block_num: 99,
      ref_block_prefix: 3704360964,
      expiration: '2030-01-01T12:00:00.123',
      operations: [['transfer', { from: 'alice' }]],
      extensions: [],
      signatures: ['KEYCHAIN_SIG'],
    };
    const requestSignTx = vi.fn(
      (
        username: string,
        tx: unknown,
        role: string,
        callback: (r: { success: boolean; result: unknown }) => void
      ) => {
        expect(username).toBe('alice');
        expect(role).toBe('Active');
        expect((tx as { ref_block_num: number }).ref_block_num).toBe(99);
        callback({ success: true, result: signedTx });
      }
    );
    (window as unknown as { steem_keychain: unknown }).steem_keychain = { requestSignTx };

    const result = await SteemSigner.signTransaction(
      [['transfer', { from: 'alice' }]],
      [keychainKey('alice', 'Active')]
    );

    expect(result).toBe(signedTx);
    expect(requestSignTx).toHaveBeenCalledTimes(1);
    expect(steem.auth.signTransaction).not.toHaveBeenCalled();
  });

  it('rejects rather than falling back to local signing when Keychain is not installed', async () => {
    await expect(
      SteemSigner.signTransaction([['transfer', {}]], [keychainKey('alice', 'Posting')])
    ).rejects.toThrow('Steem Keychain is not installed');
    expect(steem.auth.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses to mix a keychain key with a second key (not a case this app produces)', async () => {
    await expect(
      SteemSigner.signTransaction(
        [['transfer', {}]],
        [keychainKey('alice', 'Active'), '5JsecondKey']
      )
    ).rejects.toThrow('does not support multi-key');
  });
});
