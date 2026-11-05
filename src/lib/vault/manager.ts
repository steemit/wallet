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
      validateVaultPassword(newPassword);
      const record = await requireRecord(vaultName);
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
