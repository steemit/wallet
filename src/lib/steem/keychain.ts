'use client';

/**
 * Steem Keychain browser-extension bridge.
 *
 * Keychain holds private keys inside the extension and never exposes them to
 * the page. It exposes two calls this app uses:
 *   - `requestSignBuffer`: sign an arbitrary string (used for the login
 *     challenge) and return the signature + the public key that signed.
 *   - `requestSignTx`: sign a prepared (unsigned) transaction and return a
 *     broadcast-ready SIGNED transaction.
 *
 * Response shape (Keychain's public API, shared with Hive Keychain):
 *   requestSignBuffer → { success, result: <signature string>, publicKey, message, error }
 *   requestSignTx     → { success, result: <signed tx object>, message, error }
 * `error` is usually a string but some extension versions pass
 * `{ message }`; `errorMessage()` below handles both.
 *
 * The signed tx coming back from `requestSignTx` is used AS-IS — never
 * re-normalized — matching the relay's "never rewrite a signed tx" rule
 * (docs/AI-driver/01-architecture.md). The same existing `/api/broadcast/*`
 * routes accept it unchanged; this module has no server-side counterpart.
 */

import type { Operation, SignedTransaction } from './types';
import type { KeychainKeyRole } from './signing-key';

interface KeychainErrorLike {
  message?: string;
  error?: string | { message?: string } | null;
}

interface KeychainSignBufferResponse extends KeychainErrorLike {
  success: boolean;
  result?: string;
  publicKey?: string;
}

interface KeychainSignTxResponse extends KeychainErrorLike {
  success: boolean;
  result?: unknown;
}

type UnsignedTx = {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  operations: Operation[];
  extensions: unknown[];
};

interface KeychainWindowApi {
  requestSignBuffer: (
    username: string,
    message: string,
    role: 'Posting' | 'Active' | 'Owner' | 'Memo',
    callback: (response: KeychainSignBufferResponse) => void,
    rpc?: string | null
  ) => void;
  requestSignTx: (
    username: string,
    tx: unknown,
    role: 'Posting' | 'Active' | 'Owner',
    callback: (response: KeychainSignTxResponse) => void,
    rpc?: string | null
  ) => void;
}

declare global {
  interface Window {
    steem_keychain?: KeychainWindowApi;
  }
}

/** Whether the Steem Keychain browser extension is installed and active. */
export function isKeychainInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.steem_keychain;
}

function errorMessage(response: KeychainErrorLike): string {
  if (typeof response.error === 'string' && response.error) return response.error;
  if (response.error && typeof response.error === 'object' && response.error.message) {
    return response.error.message;
  }
  return response.message || 'Steem Keychain request failed';
}

/**
 * Sign a string with the given authority (login challenge). Returns only the
 * signature and the public key Keychain used — the private key never leaves
 * the extension.
 */
export function keychainSignBuffer(
  username: string,
  message: string,
  role: 'Posting'
): Promise<{ publicKey: string; signature: string }> {
  return new Promise((resolve, reject) => {
    const keychain = window.steem_keychain;
    if (!keychain) {
      reject(new Error('Steem Keychain is not installed'));
      return;
    }
    try {
      keychain.requestSignBuffer(username, message, role, (response) => {
        if (!response.success || !response.result || !response.publicKey) {
          reject(new Error(errorMessage(response)));
          return;
        }
        resolve({ publicKey: response.publicKey, signature: response.result });
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Steem Keychain request failed'));
    }
  });
}

/**
 * Sign a prepared (unsigned) transaction with the given authority. The
 * resolved value is already a broadcast-ready SignedTransaction.
 */
export function keychainSignTx(
  username: string,
  tx: UnsignedTx,
  role: KeychainKeyRole
): Promise<SignedTransaction> {
  return new Promise((resolve, reject) => {
    const keychain = window.steem_keychain;
    if (!keychain) {
      reject(new Error('Steem Keychain is not installed'));
      return;
    }
    try {
      keychain.requestSignTx(username, tx, role, (response) => {
        if (!response.success || !response.result) {
          reject(new Error(errorMessage(response)));
          return;
        }
        resolve(response.result as SignedTransaction);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Steem Keychain request failed'));
    }
  });
}
