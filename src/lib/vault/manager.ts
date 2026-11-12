import { decodeBase64Url, emptyVaultRoleKeys, encodeBase64Url } from './envelope';
import {
  decryptVaultKey,
  deriveVaultKek,
  encryptVaultKeyRecord,
  generateVaultSalt,
} from './crypto';
import { VaultError } from './errors';
import { exportVaultBackup, importVaultBackup, mergeVaultBackup } from './backup';
import type { VaultRegistry, VaultRevisionPointer } from './registry';
import { createVaultService, type VaultService, type VaultServiceStatus } from './service';
import { createVaultSigner } from './signer';
import type {
  ImportVaultParams,
  SignOperationsRequest,
  SignResolvedTransactionRequest,
  SignResult,
  VaultAccountEntry,
  VaultAccountSummary,
  VaultEnvelopeV1,
  VaultKeyInput,
  VaultKeyPointer,
  VaultManager,
  VaultRecordV1,
  VaultSummary,
} from './types';
import { validateVaultPassword, vaultNameComparisonKey } from './validation';

export interface ImportVaultDetailedResult {
  summary: VaultSummary;
  preMergeBackup: VaultEnvelopeV1 | null;
}

function notFound(): VaultError {
  return new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
}

function pointerOf(record: VaultRecordV1): VaultRevisionPointer {
  return {
    vaultName: record.vaultName,
    createdAt: record.createdAt,
    revision: record.revision,
    lockEpoch: record.lockEpoch,
  };
}

export interface VaultManagerExtended extends VaultManager {
  unlockVault(vaultName: string, password: string): Promise<VaultServiceStatus>;
  importVaultDetailed(params: ImportVaultParams): Promise<ImportVaultDetailedResult>;
  addKey(input: VaultKeyInput): Promise<VaultRecordV1>;
  removeKey(pointer: VaultKeyPointer): Promise<VaultRecordV1>;
  updateKeyNote(pointer: VaultKeyPointer, note: string): Promise<VaultRecordV1>;
  /**
   * Read-only snapshot of the stored records the current code cannot read —
   * the exact rows {@link VaultManagerExtended.cleanupUnreadableVaults}
   * deletes. Each entry carries the row's primary key, its raw display name
   * (`null` when the row carries none) and the VERBATIM stored value
   * (`record`, unknown shape: this version cannot interpret it — it is an
   * as-is archival copy, not a re-importable backup).
   *
   * UI CONTRACT: call this BEFORE `cleanupUnreadableVaults` — the cleanup
   * dialog snapshots and downloads these rows first, and only purges once
   * the copy has been delivered. After the purge the rows are gone.
   */
  listUnreadableVaultRecords(): Promise<
    Array<{ key: IDBValidKey; vaultName: string | null; record: unknown }>
  >;
  /**
   * Remove every stored vault record the current code can no longer read
   * (incompatible envelope versions — e.g. whole-vault-format rows left by
   * the never-shipped A5 build, which has no migration layer by design) and
   * clear the active-vault pointer when it names one of them.
   *
   * UI CONTRACT: call this ONLY after the user has explicitly confirmed the
   * purge in the cleanup dialog (the panel offers it when the vault list
   * fails to load with `VAULT_ENVELOPE_INVALID`), and only AFTER the raw rows
   * have been snapshotted via `listUnreadableVaultRecords` and downloaded —
   * a failed download aborts the purge. Removed records are unrecoverable;
   * readable vaults and every other settings field are never touched.
   * Returns the removed rows' names (`null` when a raw row carries none —
   * the UI filters those out when listing names).
   */
  cleanupUnreadableVaults(): Promise<{ removed: Array<string | null> }>;
  createSigner(): {
    signOperations(request: SignOperationsRequest): Promise<SignResult>;
    signResolvedTransaction(request: SignResolvedTransactionRequest): Promise<SignResult>;
  };
  destroy(): void;
}

async function tolerantStatus(service: VaultService): Promise<VaultServiceStatus> {
  try {
    return await service.getStatus();
  } catch (error) {
    if (error instanceof VaultError && error.code === 'VAULT_SESSION_STALE') {
      return { locked: true, vaultName: null, revision: null, lockEpoch: null };
    }
    throw error;
  }
}

function statusMatchesVault(status: VaultServiceStatus, vaultName: string): boolean {
  return (
    !status.locked &&
    status.vaultName !== null &&
    vaultNameComparisonKey(status.vaultName) === vaultNameComparisonKey(vaultName)
  );
}

/** True when the record carries no key ciphertext at all (the empty-vault state). */
function recordHasNoKeys(record: VaultRecordV1): boolean {
  return record.accounts.every((account) =>
    (['owner', 'active', 'posting', 'memo'] as const).every(
      (role) => account.keys[role].length === 0,
    ),
  );
}

export function createVaultManager(registry: VaultRegistry): VaultManagerExtended {
  const service = createVaultService(registry);

  async function summarize(
    record: VaultRecordV1,
    status: VaultServiceStatus,
  ): Promise<VaultSummary> {
    const settings = await registry.getSettings();
    const active =
      settings.activeVaultName !== null &&
      vaultNameComparisonKey(settings.activeVaultName) === vaultNameComparisonKey(record.vaultName);
    return {
      vaultName: record.vaultName,
      active,
      locked: !statusMatchesVault(status, record.vaultName),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastBackupAt: record.lastBackupAt,
    };
  }

  async function requireRecord(vaultName: string): Promise<VaultRecordV1> {
    const record = await registry.getRecord(vaultName);
    if (record === null) throw notFound();
    return record;
  }

  async function importVaultDetailed(params: ImportVaultParams): Promise<ImportVaultDetailedResult> {
    if (params.mode === 'independent') {
      const record = await importVaultBackup(registry, params);
      return {
        summary: await summarize(record, await tolerantStatus(service)),
        preMergeBackup: null,
      };
    }
    // Target-password merge contract: callers do NOT pre-unlock the target —
    // the manager authenticates it here with `targetPassword` (one unlock
    // probe: derive + authenticate the first key, retain only the
    // non-sensitive record pointer). An existing session on the target is
    // reused as-is; the password is still authenticated by the merge's own
    // per-key target decryption inside mergeVaultBackup.
    const status = await tolerantStatus(service);
    if (!statusMatchesVault(status, params.targetVaultName)) {
      await service.unlock(params.targetVaultName, params.targetPassword);
    }
    const merged = await mergeVaultBackup(registry, service, params);
    await service.lock();
    const record = await requireRecord(params.targetVaultName);
    return {
      summary: await summarize(record, {
        locked: true,
        vaultName: null,
        revision: null,
        lockEpoch: null,
      }),
      preMergeBackup: merged.preMergeBackup,
    };
  }

  return {
    async listVaults(): Promise<VaultSummary[]> {
      const records = await registry.listRecords();
      const status = await tolerantStatus(service);
      return Promise.all(records.map((record) => summarize(record, status)));
    },

    async createVault(params: { vaultName: string; password: string }): Promise<VaultSummary> {
      const record = await registry.createVault(params);
      return summarize(record, await tolerantStatus(service));
    },

    async importVault(params: ImportVaultParams): Promise<VaultSummary> {
      return (await importVaultDetailed(params)).summary;
    },

    importVaultDetailed,

    async activateVault(vaultName: string): Promise<void> {
      const record = await requireRecord(vaultName);
      const settings = await registry.getSettings();
      await registry.putSettings({ ...settings, activeVaultName: record.vaultName });
    },

    async renameVault(oldName: string, newName: string): Promise<void> {
      await registry.renameVault(oldName, newName);
    },

    async removeVault(vaultName: string, password: string): Promise<void> {
      const probe = createVaultService(registry);
      try {
        await probe.unlock(vaultName, password);
      } finally {
        probe.destroy();
      }
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) await service.lock();
      await registry.removeVault(vaultName);
    },

    listUnreadableVaultRecords(): Promise<
      Array<{ key: IDBValidKey; vaultName: string | null; record: unknown }>
    > {
      // Thin pass-through, same division of labor as cleanupUnreadableVaults:
      // the verdict (which rows are unreadable) lives in the registry.
      return registry.listInvalidVaultRecords();
    },

    cleanupUnreadableVaults(): Promise<{ removed: Array<string | null> }> {
      // Thin orchestration: the verdict (which rows are unreadable), the
      // atomic delete + pointer reset, and the user-confirmation contract
      // live in the registry primitive.
      return registry.purgeInvalidVaultRecords();
    },

    async exportVault(vaultName: string): Promise<VaultEnvelopeV1> {
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) await service.lock();
      return exportVaultBackup(registry, vaultName);
    },

    async lockVault(vaultName?: string): Promise<void> {
      if (vaultName === undefined) {
        await service.lock();
        return;
      }
      const status = await tolerantStatus(service);
      if (statusMatchesVault(status, vaultName)) {
        await service.lock();
        return;
      }
      await registry.bumpLockEpoch(vaultName);
    },

    async changePassword(
      vaultName: string,
      oldPassword: string,
      newPassword: string,
    ): Promise<void> {
      await service.unlock(vaultName, oldPassword);
      const record = await requireRecord(vaultName);
      // Empty-vault password anchor (2026-11-05 ruling): with no key
      // ciphertext the old password cannot be authenticated (unlock accepts
      // any password for an empty vault), so changing it is meaningless — the
      // password of the NEXT addKey is the real anchor. Checked before the
      // new-password policy: the operation is refused regardless of inputs.
      if (recordHasNoKeys(record)) {
        throw new VaultError(
          'VAULT_EMPTY',
          'the vault holds no keys yet; the password of the next added key is the anchor',
        );
      }
      validateVaultPassword(newPassword);
      const status = await service.getStatus();
      if (status.locked) {
        throw new VaultError('VAULT_SESSION_STALE', 'the vault changed during password authentication');
      }
      const newSalt = generateVaultSalt();
      const oldKek = await deriveVaultKek(oldPassword, decodeBase64Url(record.salt));
      const newKek = await deriveVaultKek(newPassword, newSalt);
      try {
        const accounts: VaultAccountEntry[] = [];
        const ivs: string[] = [];
        for (const account of record.accounts) {
          const nextAccount: VaultAccountEntry = {
            accountName: account.accountName,
            keys: emptyVaultRoleKeys(),
          };
          accounts.push(nextAccount);
          for (const role of ['owner', 'active', 'posting', 'memo'] as const) {
            for (const key of account.keys[role]) {
              let privateKey = await decryptVaultKey(
                oldKek,
                decodeBase64Url(key.iv),
                decodeBase64Url(key.ciphertext),
              );
              const encrypted = await encryptVaultKeyRecord(newKek, privateKey, key.note, ivs);
              privateKey = '';
              ivs.push(encrypted.iv);
              nextAccount.keys[role].push(encrypted);
            }
          }
        }
        await registry.swapRecord(pointerOf(record), {
          ...record,
          salt: encodeBase64Url(newSalt),
          accounts,
          revision: record.revision + 1,
          updatedAt: Date.now(),
        });
      } finally {
        oldKek.fill(0);
        newKek.fill(0);
      }
      await service.lock();
    },

    getAccounts(vaultName?: string): Promise<VaultAccountSummary[]> {
      return service.getAccounts(vaultName);
    },

    unlockVault(vaultName: string, password: string): Promise<VaultServiceStatus> {
      return service.unlock(vaultName, password);
    },

    addKey(input: VaultKeyInput): Promise<VaultRecordV1> {
      return service.addKey(input);
    },

    removeKey(pointer: VaultKeyPointer): Promise<VaultRecordV1> {
      return service.removeKey(pointer);
    },

    updateKeyNote(pointer: VaultKeyPointer, note: string): Promise<VaultRecordV1> {
      return service.updateKeyNote(pointer, note);
    },

    createSigner() {
      return createVaultSigner(service);
    },

    destroy(): void {
      service.destroy();
    },
  };
}
