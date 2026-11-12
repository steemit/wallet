import type { Operation, SignedTransaction } from '@/lib/steem/types';

export type UnsignedTransaction = Omit<SignedTransaction, 'signatures'>;

export type VaultKeyRole = 'owner' | 'active' | 'posting' | 'memo';
export type SigningRole = Exclude<VaultKeyRole, 'memo'>;
export type SigningMode = 'privateKey' | 'vault';

/**
 * PUBLIC: account names, roles, IVs and notes are visible while locked —
 * and so is `publicKey` (a Steem public key is inherently public; after any
 * on-chain verification it is world-visible on the chain anyway).
 *
 * `publicKey` is OPTIONAL outer data: entries written before it existed (and
 * entries re-encrypted from such entries) simply omit it. It is persisted by
 * the add/import paths (derived from the WIF at entry time or carried from a
 * source entry that already had it) so the key manager can display and
 * deduplicate keys while the vault stays LOCKED — decryption is never needed
 * to know a stored entry's public key.
 */
export interface VaultKeyCiphertext {
  iv: string;
  ciphertext: string;
  note: string;
  publicKey?: string;
}

export type VaultRoleKeys = Record<VaultKeyRole, VaultKeyCiphertext[]>;

export interface VaultAccountEntry {
  accountName: string;
  keys: VaultRoleKeys;
}

/** The complete V1 storage and backup format. */
export interface VaultEnvelopeV1 {
  version: 1;
  vaultName: string;
  salt: string;
  accounts: VaultAccountEntry[];
}

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

export interface VaultSummary {
  vaultName: string;
  active: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  lastBackupAt: number | null;
}

/** PUBLIC: IV is the selection pointer for the current encrypted record. */
export interface VaultKeySummary {
  role: VaultKeyRole;
  iv: string;
  note: string;
  /** Outer public key when the stored entry carries one; `null` for legacy entries. */
  publicKey: string | null;
}

export interface VaultAccountSummary {
  accountName: string;
  keys: VaultKeySummary[];
  balances: Record<string, string> | null;
}

/** SENSITIVE: only the selected key is open inside one signing operation. */
export interface VaultSigningSession {
  vaultName: string;
  revision: number;
  lockEpoch: number;
  kek: Uint8Array;
  accountName: string;
  role: SigningRole;
  privateKey: string;
}

export const VAULT_ERROR_CODES = [
  'VAULT_NAME_EXISTS',
  'VAULT_NOT_FOUND',
  'VAULT_EMPTY',
  'VAULT_MODE_REQUIRED',
  'VAULT_OPERATION_UNSUPPORTED',
  'VAULT_LOCKED',
  'VAULT_PASSWORD_INVALID',
  'VAULT_ENVELOPE_INVALID',
  'VAULT_PAYLOAD_INVALID',
  'VAULT_SESSION_STALE',
  'VAULT_STORAGE_UNAVAILABLE',
  'VAULT_CRYPTO_UNAVAILABLE',
  'VAULT_NAME_INVALID',
  'VAULT_PASSWORD_WEAK',
  'VAULT_KEY_INVALID',
  'VAULT_LIMIT_EXCEEDED',
  'VAULT_AUTHORITY_UNAVAILABLE',
] as const;

export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[number];

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
      targetPassword: string;
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
  getAccounts(vaultName?: string): Promise<VaultAccountSummary[]>;
}

export interface VaultKeyInput {
  vaultName: string;
  accountName: string;
  role: VaultKeyRole;
  privateKey: string;
  note: string;
  password: string;
  /**
   * Public key the caller derived from `privateKey` (e.g. during the add-key
   * dialog's on-chain verification). OPTIONAL — when absent, `addKey` derives
   * and persists the public key from the WIF itself.
   */
  publicKey?: string;
}

export interface VaultKeyPointer {
  vaultName: string;
  accountName: string;
  role: VaultKeyRole;
  keyIv: string;
}

export interface SignOperationsRequest {
  accountName: string;
  role: SigningRole;
  keyIv: string;
  vaultPassword: string;
  operations: Operation[];
}

export interface SignResolvedTransactionRequest {
  accountName: string;
  role: SigningRole;
  keyIv: string;
  vaultPassword: string;
  transaction: UnsignedTransaction;
}

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
