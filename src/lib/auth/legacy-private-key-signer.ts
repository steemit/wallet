// Legacy privateKey-mode signer (A4) — implements the same `VaultSigner`
// interface as the vault signer but sources its WIF from an injected getter
// instead of a vault session, PRESERVING today's privateKey-mode behavior.
//
// A6 WIRING CONTRACT: the caller injects the key source at creation time —
//
//   const legacySigner = createLegacyPrivateKeySigner((accountName, role) => {
//     // read from the login state (Redux auth slice / remembered posting key),
//     // return undefined when this session cannot sign for that role
//   });
//   const facade = createSigningFacade(registry, {
//     vaultSigner: manager.createSigner(),
//     legacySigner,
//   });
//
// The getter is invoked per signing request with the normalized account name
// and the requested role, and may return `undefined` (no key held — mapped to
// `VAULT_KEY_INVALID` so the A5/A6 UI can route to re-auth guidance). It must
// never be handed a component callback that captures anything beyond the
// login state.
//
// DELIBERATE DIFFERENCE from the vault signer (A6 acceptance: "default
// privateKey behavior unchanged"): NO pre-signing on-chain authority check.
// Today's `src/lib/steem/client.ts` signing path consults no authority data,
// and the facade must not make privateKey mode slower or fail where it works
// today; the fresh `/api/query/accounts` verification is a vault-mode-only
// guarantee. Consequences, accepted on purpose: a posting-key request for an
// active-class operation is signed locally and rejected by the chain (same
// as the current client), and a degraded RPC does not block privateKey-mode
// signing.
//
// Shared with the vault signer: the A4 operation table (`memo` never signs,
// unknown operations fail closed with `VAULT_OPERATION_UNSUPPORTED`).
//
// SENSITIVE-DATA RULES: the WIF exists only as a getter result inside the
// signing call and goes straight into `steem.auth.signTransaction`
// (client-side only). It never appears in `SignResult`, error messages or
// logs.
import { steem } from '@steemit/steem-js';

import { apiClient } from '@/lib/steem/client';
import type {
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  SigningRole,
  UnsignedTransaction,
} from '@/lib/vault/types';
import { VaultError } from '@/lib/vault/errors';
import {
  normalizeRequestAccount,
  requireSigningRole,
  resolveRequiredAuthorityClass,
} from '@/lib/vault/signer';
import { validateVaultWif } from '@/lib/vault/validation';

/**
 * Resolves the WIF for an account/role pair at signing time. Return
 * `undefined` when no key is available (re-auth territory). A4 tests inject
 * mocks; A6 wires this to the login state.
 */
export type LegacyPrivateKeyGetter = (
  accountName: string,
  role: SigningRole,
) => string | undefined;

function keyUnavailable(reason: string): VaultError {
  return new VaultError('VAULT_KEY_INVALID', reason);
}

/** Resolve + validate the WIF for a request; returns WIF and public key. */
function resolveKey(
  getPrivateKey: LegacyPrivateKeyGetter,
  accountName: string,
  role: SigningRole,
): { wif: string; publicKey: string } {
  const wif = getPrivateKey(accountName, role);
  if (typeof wif !== 'string' || wif.length === 0) {
    throw keyUnavailable('no private key is available for the requested account and role');
  }
  // Shared entry point: real isWif checksum + public-key derivation +
  // normalizeSteemUsername account normalization (mock-driven under vitest;
  // real-crypto evidence lives in tests/node/vault-wif-real-check.mjs).
  const check = validateVaultWif(wif, accountName);
  return { wif, publicKey: check.publicKey };
}

/** Transaction id = first 20 bytes of SHA-256 over the unsigned serialization. */
async function computeTransactionId(unsigned: UnsignedTransaction): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) {
    throw new VaultError(
      'VAULT_CRYPTO_UNAVAILABLE',
      'Web Crypto subtle API is unavailable in this environment',
    );
  }
  const normalized = steem.auth.normalizeTransactionForBroadcast(
    unsigned as unknown as Record<string, unknown>,
  );
  const bytes = new Uint8Array(steem.auth.serializeTransaction(normalized));
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < 20; i += 1) {
    hex += (digest[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Build the privateKey-mode signer. `getPrivateKey` is the ONLY key source —
 * the signer itself stores nothing, so a stolen signer object holds no key
 * material.
 */
export function createLegacyPrivateKeySigner(getPrivateKey: LegacyPrivateKeyGetter): {
  signOperations(request: SignOperationsRequest): Promise<SignResult>;
  signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult>;
} {
  return {
    /**
     * Sign freshly built operations with the login-state key for the
     * requested role. No authority precheck (see the module header); the
     * caller's role choice is trusted exactly as `src/lib/steem/client.ts`
     * trusts its callers today — the chain remains the validator.
     */
    async signOperations(request: SignOperationsRequest): Promise<SignResult> {
      resolveRequiredAuthorityClass(request?.operations);
      const role = requireSigningRole(request?.role);
      const accountName = normalizeRequestAccount(request);
      const key = resolveKey(getPrivateKey, accountName, role);
      const header = await apiClient.getTransactionHeader();
      const unsigned: UnsignedTransaction = {
        ref_block_num: header.ref_block_num,
        ref_block_prefix: header.ref_block_prefix,
        expiration: header.expiration,
        operations: request.operations,
        extensions: [],
      };
      const signed = steem.auth.signTransaction(unsigned, [key.wif]);
      const signedTx = steem.auth.normalizeTransactionForBroadcast(
        signed as unknown as Record<string, unknown>,
      ) as unknown as SignResult['signedTx'];
      return {
        signedTx,
        transactionId: await computeTransactionId(unsigned),
        accountName,
        role, // the requested role is the role used — no chain-based selection here
        publicKey: key.publicKey,
        locked: false, // no vault session exists in privateKey mode
      };
    },

    /**
     * Sign a frozen transaction verbatim — no header refresh, no
     * reconstruction, no normalization of non-signature fields. The
     * transaction object passes as-is into the signing call.
     */
    async signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult> {
      const transaction = request?.transaction;
      if (
        typeof transaction !== 'object' ||
        transaction === null ||
        !Number.isFinite(transaction.ref_block_num) ||
        !Number.isFinite(transaction.ref_block_prefix) ||
        typeof transaction.expiration !== 'string' ||
        transaction.expiration.length === 0 ||
        !Array.isArray(transaction.operations)
      ) {
        throw new VaultError(
          'VAULT_OPERATION_UNSUPPORTED',
          'transaction is not a frozen unsigned transaction',
        );
      }
      resolveRequiredAuthorityClass(transaction.operations);
      const role = requireSigningRole(request?.role);
      const accountName = normalizeRequestAccount(request);
      const key = resolveKey(getPrivateKey, accountName, role);
      const signed = steem.auth.signTransaction(transaction, [key.wif]);
      return {
        signedTx: signed as SignResult['signedTx'],
        transactionId: await computeTransactionId({ ...transaction }),
        accountName,
        role,
        publicKey: key.publicKey,
        locked: false,
      };
    },
  };
}
