import { decodeBase64Url, emptyVaultRoleKeys, validateVaultEnvelope } from './envelope';
import {
  decryptVaultKey,
  deriveVaultKek,
  encryptVaultKeyRecord,
  withVaultPublicKey,
} from './crypto';
import { VaultError } from './errors';
import {
  vaultRecordToEnvelope,
  type VaultRegistry,
  type VaultRevisionPointer,
} from './registry';
import type { VaultService, VaultServiceStatus } from './service';
import type {
  VaultAccountEntry,
  VaultEnvelopeV1,
  VaultKeyCiphertext,
  VaultKeyRole,
  VaultRecordV1,
} from './types';
import { normalizeSteemUsername } from '@/lib/steem/username';
import { validateVaultPassword, validateVaultWif, vaultNameComparisonKey } from './validation';

export type IndependentImportParams = Extract<ImportParameters, { mode: 'independent' }>;
export type MergeImportParams = Extract<ImportParameters, { mode: 'merge' }>;
type ImportParameters = import('./types').ImportVaultParams;

interface KeyRef {
  accountName: string;
  role: VaultKeyRole;
  key: VaultKeyCiphertext;
}

const ROLES: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

function* keyRefs(accounts: readonly VaultAccountEntry[]): Generator<KeyRef> {
  for (const account of accounts) {
    for (const role of ROLES) {
      for (const key of account.keys[role]) {
        yield { accountName: account.accountName, role, key };
      }
    }
  }
}

function pointerOf(record: VaultRecordV1): VaultRevisionPointer {
  return {
    vaultName: record.vaultName,
    createdAt: record.createdAt,
    revision: record.revision,
    lockEpoch: record.lockEpoch,
  };
}

function dedupeKey(accountName: string, role: VaultKeyRole, publicKey: string): string {
  return `${normalizeSteemUsername(accountName)}\u0000${role}\u0000${publicKey}`;
}

function addEncryptedKey(
  accounts: VaultAccountEntry[],
  accountName: string,
  role: VaultKeyRole,
  key: VaultKeyCiphertext,
): void {
  const normalized = normalizeSteemUsername(accountName);
  let account = accounts.find(
    (candidate) => normalizeSteemUsername(candidate.accountName) === normalized,
  );
  if (!account) {
    account = { accountName: normalized, keys: emptyVaultRoleKeys() };
    accounts.push(account);
  }
  account.keys[role].push({ ...key });
}

async function decryptAndValidate(
  kek: Uint8Array<ArrayBuffer>,
  ref: KeyRef,
): Promise<{ privateKey: string; publicKey: string }> {
  const privateKey = await decryptVaultKey(
    kek,
    decodeBase64Url(ref.key.iv),
    decodeBase64Url(ref.key.ciphertext),
  );
  const check = validateVaultWif(privateKey, ref.accountName);
  return { privateKey, publicKey: check.publicKey };
}

async function authenticateEnvelope(
  envelope: VaultEnvelopeV1,
  kek: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const first = keyRefs(envelope.accounts).next();
  if (!first.done) {
    const opened = await decryptAndValidate(kek, first.value);
    opened.privateKey = '';
  }
}

function createdInstanceReplaced(): VaultError {
  return new VaultError(
    'VAULT_SESSION_STALE',
    'the vault created by this import is no longer the stored instance',
  );
}

async function rollbackCreatedVault(
  registry: VaultRegistry,
  created: VaultRecordV1,
): Promise<void> {
  try {
    const current = await registry.getRecord(created.vaultName);
    if (current !== null && current.createdAt !== created.createdAt) return;
    await registry.removeVault(created.vaultName);
  } catch {
    // Best-effort rollback; the import error remains the primary failure.
  }
}

export async function exportVaultBackup(
  registry: VaultRegistry,
  vaultName: string,
): Promise<VaultEnvelopeV1> {
  const record = await registry.getRecord(vaultName);
  if (record === null) throw new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
  const envelope = vaultRecordToEnvelope(record);
  const now = Date.now();
  await registry.swapRecord(pointerOf(record), {
    ...record,
    revision: record.revision + 1,
    updatedAt: now,
    lastBackupAt: now,
  });
  return envelope;
}

/** Import by re-encrypting each source WIF immediately; plaintext is never accumulated. */
export async function importVaultBackup(
  registry: VaultRegistry,
  params: IndependentImportParams,
): Promise<VaultRecordV1> {
  const source = validateVaultEnvelope(params.envelope);
  const sourceKek = await deriveVaultKek(params.password, decodeBase64Url(source.salt));
  let targetKek: Uint8Array<ArrayBuffer> | null = null;
  let created: VaultRecordV1 | null = null;
  try {
    await authenticateEnvelope(source, sourceKek);
    validateVaultPassword(params.password);
    created = await registry.createVault({ vaultName: params.vaultName, password: params.password });
    targetKek = await deriveVaultKek(params.password, decodeBase64Url(created.salt));
    const accounts: VaultAccountEntry[] = [];
    const seen = new Set<string>();
    const ivs: string[] = [];
    for (const ref of keyRefs(source.accounts)) {
      const opened = await decryptAndValidate(sourceKek, ref);
      // The source entry's declared publicKey (outer public data) rides along
      // as-is; a legacy entry without the field is backfilled with the
      // public key derived from the mandatory WIF validation above.
      const publicKey = ref.key.publicKey ?? opened.publicKey;
      const identity = dedupeKey(ref.accountName, ref.role, publicKey);
      if (seen.has(identity)) {
        opened.privateKey = '';
        continue;
      }
      seen.add(identity);
      const encrypted = await encryptVaultKeyRecord(
        targetKek,
        opened.privateKey,
        ref.key.note,
        ivs,
      );
      opened.privateKey = '';
      ivs.push(encrypted.iv);
      addEncryptedKey(accounts, ref.accountName, ref.role, withVaultPublicKey(encrypted, publicKey));
    }
    const next: VaultRecordV1 = {
      ...created,
      accounts,
      revision: created.revision + 1,
      updatedAt: Date.now(),
    };
    await registry.swapRecord(pointerOf(created), next);
    const current = await registry.getRecord(created.vaultName);
    if (current === null || current.createdAt !== created.createdAt) throw createdInstanceReplaced();
    return current;
  } catch (error) {
    if (created !== null) await rollbackCreatedVault(registry, created);
    throw error;
  } finally {
    sourceKek.fill(0);
    targetKek?.fill(0);
  }
}

export interface VaultMergeResult {
  status: VaultServiceStatus;
  preMergeBackup: VaultEnvelopeV1;
}

/** Merge source keys under the target KEK while preserving winning target ciphertext. */
export async function mergeVaultBackup(
  registry: VaultRegistry,
  service: VaultService,
  params: MergeImportParams,
): Promise<VaultMergeResult> {
  const status = await service.getStatus();
  // Match the target like the manager does (NFC + case-folded comparison
  // key): a session opened under a case variant of the target name selects
  // the same vault and must satisfy the merge contract too.
  if (
    status.locked ||
    status.vaultName === null ||
    vaultNameComparisonKey(status.vaultName) !== vaultNameComparisonKey(params.targetVaultName)
  ) {
    throw new VaultError('VAULT_LOCKED', 'the target vault is not selected in this session');
  }
  const record = await registry.getRecord(status.vaultName);
  if (record === null) throw new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
  // Empty-target password anchor (2026-11-05 ruling): a vault with no key
  // ciphertext has nothing that could authenticate `targetPassword` — the
  // per-key target decryption loop below would iterate zero times and the
  // source keys would land re-encrypted under WHATEVER password was typed
  // (a silent re-key). Fail closed here, BEFORE any password is used.
  if (keyRefs(record.accounts).next().done) {
    throw new VaultError(
      'VAULT_EMPTY',
      'the target vault holds no keys yet; add a key to it or use an independent import instead',
    );
  }
  const preMergeBackup = vaultRecordToEnvelope(record);
  const source = validateVaultEnvelope(params.envelope);
  const sourceKek = await deriveVaultKek(params.password, decodeBase64Url(source.salt));
  const targetKek = await deriveVaultKek(params.targetPassword, decodeBase64Url(record.salt));
  try {
    const accounts: VaultAccountEntry[] = [];
    const seen = new Set<string>();
    const ivs: string[] = [];
    for (const ref of keyRefs(record.accounts)) {
      ivs.push(ref.key.iv);
      const opened = await decryptAndValidate(targetKek, ref);
      opened.privateKey = '';
      // Target decryption doubles as authentication; the dedupe identity
      // prefers the declared outer publicKey when the entry carries one.
      // The winning entry itself is preserved byte-identically (publicKey
      // included — it is part of the stored object).
      const identity = dedupeKey(ref.accountName, ref.role, ref.key.publicKey ?? opened.publicKey);
      if (seen.has(identity)) continue;
      seen.add(identity);
      addEncryptedKey(accounts, ref.accountName, ref.role, ref.key);
    }
    for (const ref of keyRefs(source.accounts)) {
      const opened = await decryptAndValidate(sourceKek, ref);
      // The source entry's declared publicKey (outer public data) rides along
      // as-is; a legacy entry without the field is backfilled with the
      // public key derived from the mandatory WIF validation above.
      const publicKey = ref.key.publicKey ?? opened.publicKey;
      const identity = dedupeKey(ref.accountName, ref.role, publicKey);
      if (seen.has(identity)) {
        opened.privateKey = '';
        continue;
      }
      seen.add(identity);
      const encrypted = await encryptVaultKeyRecord(
        targetKek,
        opened.privateKey,
        ref.key.note,
        ivs,
      );
      opened.privateKey = '';
      ivs.push(encrypted.iv);
      addEncryptedKey(accounts, ref.accountName, ref.role, withVaultPublicKey(encrypted, publicKey));
    }
    await service.commitAccounts(record, accounts);
    return { status: await service.getStatus(), preMergeBackup };
  } finally {
    sourceKek.fill(0);
    targetKek.fill(0);
  }
}
