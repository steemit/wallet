// Vault type contracts (A0 baseline).
//
// Ported verbatim from the vault development kickoff task package §2
// (2026-10-31; outside this repo). In-repo reference: docs/AI-driver/09-vault.md.
// Field names, unions and interface names must stay in sync with the kickoff
// document. `Operation` and `SignedTransaction` are reused from
// `src/lib/steem/types.ts` — do not define a second transaction model here.
import type { Operation, SignedTransaction } from '@/lib/steem/types';

export type UnsignedTransaction = Omit<SignedTransaction, 'signatures'>;

export type VaultKeyRole = 'owner' | 'active' | 'posting' | 'memo';

/** Signing roles exclude `memo`: a memo key can be stored but never signs. */
export type SigningRole = Exclude<VaultKeyRole, 'memo'>;

export type SigningMode = 'privateKey' | 'vault';

/**
 * SENSITIVE: holds a WIF in the clear. `VaultKeyEntry` (and therefore
 * `VaultPayloadV1`) may only exist inside the vault service closure — never
 * in Redux, logs, analytics, network requests or caller components.
 */
export interface VaultKeyEntry {
  accountName: string;
  role: VaultKeyRole;
  privateKey: string;
}

/**
 * SENSITIVE: the decrypted whole-vault payload. Whole-bucket decryption only
 * (first version): after unlock every WIF lives in vault service memory and
 * is cleared on lock. Must stay inside the vault service closure.
 */
export interface VaultPayloadV1 {
  keys: VaultKeyEntry[];
}

/** The five-field encrypted envelope that is safe to export/back up. */
export interface VaultEnvelopeV1 {
  version: 1;
  vaultName: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

/**
 * Local runtime record. `revision`, `lockEpoch` and the timestamp fields are
 * local-only runtime state and never become part of a backup (a backup is the
 * five `VaultEnvelopeV1` fields only).
 */
export interface VaultRecordV1 extends VaultEnvelopeV1 {
  revision: number;
  lockEpoch: number;
  createdAt: number;
  updatedAt: number;
  lastBackupAt: number | null;
}

export interface VaultSettingsV1 {
  schemaVersion: 1;
  signingMode: SigningMode;
  activeVaultName: string | null;
}

/**
 * PUBLIC: safe to pass across the UI. Must never carry a WIF, the KEK or the
 * decrypted payload.
 */
export interface VaultSummary {
  vaultName: string;
  active: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  lastBackupAt: number | null;
}

export interface VaultPublicKey {
  accountName: string;
  role: VaultKeyRole;
  publicKey: string;
}

/**
 * PUBLIC: safe to pass across the UI. Balances are display strings (or null
 * when not loaded); no key material is included beyond public keys.
 */
export interface VaultAccountSummary {
  accountName: string;
  keys: VaultPublicKey[];
  balances: Record<string, string> | null;
}

/**
 * SENSITIVE: holds the raw KEK and the fully decrypted payload. Only ever
 * lives inside the vault service closure; cleared in full on lock.
 */
export interface VaultUnlockSession {
  vaultName: string;
  revision: number;
  lockEpoch: number;
  kek: Uint8Array;
  payload: VaultPayloadV1;
}

export type VaultErrorCode =
  | 'VAULT_NAME_EXISTS'
  | 'VAULT_NOT_FOUND'
  | 'VAULT_EMPTY'
  | 'VAULT_MODE_REQUIRED'
  | 'VAULT_OPERATION_UNSUPPORTED'
  | 'VAULT_LOCKED'
  | 'VAULT_PASSWORD_INVALID'
  | 'VAULT_ENVELOPE_INVALID'
  | 'VAULT_PAYLOAD_INVALID'
  | 'VAULT_SESSION_STALE'
  | 'VAULT_STORAGE_UNAVAILABLE'
  | 'VAULT_CRYPTO_UNAVAILABLE'
  | 'VAULT_AUTHORITY_UNAVAILABLE';

export type ImportVaultParams =
  | {
      mode: 'independent';
      envelope: VaultEnvelopeV1;
      password: string;
      vaultName: string;
    }
  | {
      mode: 'merge';
      envelope: VaultEnvelopeV1;
      password: string;
      targetVaultName: string;
    };

export interface VaultManager {
  listVaults(): Promise<VaultSummary[]>;
  createVault(params: { vaultName: string; password: string }): Promise<VaultSummary>;
  importVault(params: ImportVaultParams): Promise<VaultSummary>;
  activateVault(vaultName: string): Promise<void>;
  renameVault(oldName: string, newName: string): Promise<void>;
  removeVault(vaultName: string, password: string): Promise<void>;
  exportVault(vaultName: string): Promise<VaultEnvelopeV1>;
  lockVault(vaultName?: string): Promise<void>;
  changePassword(vaultName: string, oldPassword: string, newPassword: string): Promise<void>;
  getAccounts(): Promise<VaultAccountSummary[]>;
}

export interface SignOperationsRequest {
  accountName: string;
  role: SigningRole;
  operations: Operation[];
}

export interface SignResolvedTransactionRequest {
  accountName: string;
  role: SigningRole;
  transaction: UnsignedTransaction;
}

/**
 * PUBLIC: safe to pass across the UI. Carries the signed transaction and its
 * public metadata only — no WIF, KEK or decrypted payload.
 *
 * `UnsignedTransaction` is the final frozen pre-signing object: once signed,
 * its non-signature fields must not be normalized again.
 */
export interface SignResult {
  signedTx: SignedTransaction;
  transactionId: string;
  accountName: string;
  role: SigningRole;
  publicKey: string;
  locked: boolean;
}

export interface VaultSigner {
  signOperations(request: SignOperationsRequest): Promise<SignResult>;
  signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult>;
}

export interface SigningFacade extends VaultSigner {
  getSigningMode(): Promise<SigningMode>;
  setSigningMode(mode: SigningMode): Promise<void>;
}
