import { decodeBase64Url, emptyVaultRoleKeys, validateVaultEnvelope } from './envelope';
import {
  decryptVaultKey,
  deriveVaultKek,
  encryptVaultKeyRecord,
} from './crypto';
import { VaultError } from './errors';
import {
  VAULT_DB_NAME,
  vaultRecordToEnvelope,
  type VaultRegistry,
  type VaultRevisionPointer,
} from './registry';
import type {
  VaultAccountEntry,
  VaultAccountSummary,
  VaultEnvelopeV1,
  VaultKeyInput,
  VaultKeyPointer,
  VaultKeyRole,
  VaultRecordV1,
} from './types';
import { normalizeSteemUsername } from '@/lib/steem/username';
import { validateVaultWif, vaultNameComparisonKey } from './validation';

export const VAULT_BROADCAST_CHANNEL = VAULT_DB_NAME;

export interface VaultServiceStatus {
  locked: boolean;
  vaultName: string | null;
  revision: number | null;
  lockEpoch: number | null;
}

interface VaultBroadcastMessage {
  kind: 'vault-lock' | 'vault-mutate';
  key: string;
}

/** Non-sensitive record selection only; no password, KEK or plaintext WIF. */
type ActiveSession = VaultRevisionPointer;

export interface VaultService {
  unlock(vaultName: string, password: string): Promise<VaultServiceStatus>;
  lock(): Promise<void>;
  getStatus(): Promise<VaultServiceStatus>;
  getAccounts(vaultName?: string): Promise<VaultAccountSummary[]>;
  getEnvelope(vaultName?: string): Promise<VaultEnvelopeV1>;
  getRecordSnapshot(vaultName?: string): Promise<VaultRecordV1>;
  assertRecordCurrent(pointer: VaultRevisionPointer): Promise<void>;
  commitAccounts(expected: VaultRecordV1, accounts: VaultAccountEntry[]): Promise<VaultRecordV1>;
  addKey(input: VaultKeyInput): Promise<VaultRecordV1>;
  removeKey(pointer: VaultKeyPointer): Promise<VaultRecordV1>;
  updateKeyNote(pointer: VaultKeyPointer, note: string): Promise<VaultRecordV1>;
  destroy(): void;
}

function locked(): VaultError {
  return new VaultError('VAULT_LOCKED', 'no vault is selected in this session');
}

function sessionStale(): VaultError {
  return new VaultError(
    'VAULT_SESSION_STALE',
    'the vault changed outside this session; select it again',
  );
}

function notFound(): VaultError {
  return new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
}

function statusOf(session: ActiveSession): VaultServiceStatus {
  return {
    locked: false,
    vaultName: session.vaultName,
    revision: session.revision,
    lockEpoch: session.lockEpoch,
  };
}

function pointerOf(record: VaultRecordV1): VaultRevisionPointer {
  return {
    vaultName: record.vaultName,
    createdAt: record.createdAt,
    revision: record.revision,
    lockEpoch: record.lockEpoch,
  };
}

function samePointer(a: VaultRevisionPointer, b: VaultRevisionPointer): boolean {
  return (
    a.vaultName === b.vaultName &&
    a.createdAt === b.createdAt &&
    a.revision === b.revision &&
    a.lockEpoch === b.lockEpoch
  );
}

function cloneAccounts(accounts: VaultAccountEntry[]): VaultAccountEntry[] {
  return JSON.parse(JSON.stringify(accounts)) as VaultAccountEntry[];
}

function firstKey(record: VaultRecordV1): {
  accountName: string;
  role: VaultKeyRole;
  iv: string;
  ciphertext: string;
} | null {
  for (const account of record.accounts) {
    for (const role of ['owner', 'active', 'posting', 'memo'] as const) {
      const key = account.keys[role][0];
      if (key) {
        return { accountName: account.accountName, role, iv: key.iv, ciphertext: key.ciphertext };
      }
    }
  }
  return null;
}

function usedIvs(record: VaultRecordV1): string[] {
  const result: string[] = [];
  for (const account of record.accounts) {
    for (const role of ['owner', 'active', 'posting', 'memo'] as const) {
      for (const key of account.keys[role]) result.push(key.iv);
    }
  }
  return result;
}

export function createVaultService(registry: VaultRegistry): VaultService {
  let session: ActiveSession | null = null;
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(VAULT_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<VaultBroadcastMessage>) => {
      const data = event.data;
      if (session === null || data === null || typeof data !== 'object') return;
      if (data.kind !== 'vault-lock' && data.kind !== 'vault-mutate') return;
      if (vaultNameComparisonKey(session.vaultName) === data.key) session = null;
    };
  }

  async function requireRecord(vaultName: string): Promise<VaultRecordV1> {
    const record = await registry.getRecord(vaultName);
    if (record === null) throw notFound();
    return record;
  }

  async function resolveRecord(vaultName?: string): Promise<VaultRecordV1> {
    if (vaultName !== undefined) return requireRecord(vaultName);
    if (session !== null) return requireRecord(session.vaultName);
    const active = (await registry.getSettings()).activeVaultName;
    if (active === null) {
      throw new VaultError('VAULT_EMPTY', 'no active vault is available');
    }
    return requireRecord(active);
  }

  async function requireFreshSession(): Promise<{ session: ActiveSession; record: VaultRecordV1 }> {
    if (session === null) throw locked();
    const snapshot = session;
    const record = await registry.getRecord(snapshot.vaultName);
    if (record === null || !samePointer(pointerOf(record), snapshot)) {
      if (session === snapshot) session = null;
      throw sessionStale();
    }
    if (session !== snapshot) throw locked();
    return { session: snapshot, record };
  }

  async function authenticate(record: VaultRecordV1, kek: Uint8Array<ArrayBuffer>): Promise<void> {
    const selected = firstKey(record);
    if (selected === null) return;
    let privateKey: string | null = null;
    try {
      privateKey = await decryptVaultKey(
        kek,
        decodeBase64Url(selected.iv),
        decodeBase64Url(selected.ciphertext),
      );
      validateVaultWif(privateKey, selected.accountName);
    } finally {
      privateKey = null;
    }
  }

  async function lock(): Promise<void> {
    if (session === null) return;
    const { vaultName } = session;
    session = null;
    try {
      await registry.bumpLockEpoch(vaultName);
    } finally {
      channel?.postMessage({ kind: 'vault-lock', key: vaultNameComparisonKey(vaultName) });
    }
  }

  async function commitAccounts(
    expected: VaultRecordV1,
    accounts: VaultAccountEntry[],
  ): Promise<VaultRecordV1> {
    const envelope = validateVaultEnvelope({
      version: 1,
      vaultName: expected.vaultName,
      salt: expected.salt,
      accounts,
    });
    if (
      session !== null &&
      vaultNameComparisonKey(session.vaultName) === vaultNameComparisonKey(expected.vaultName)
    ) {
      const fresh = await requireFreshSession();
      if (!samePointer(pointerOf(expected), pointerOf(fresh.record))) throw sessionStale();
    }
    const next: VaultRecordV1 = {
      ...expected,
      accounts: envelope.accounts,
      revision: expected.revision + 1,
      updatedAt: Date.now(),
    };
    try {
      await registry.swapRecord(pointerOf(expected), next);
    } catch (error) {
      if (
        error instanceof VaultError &&
        (error.code === 'VAULT_SESSION_STALE' || error.code === 'VAULT_NOT_FOUND') &&
        session !== null &&
        samePointer(session, pointerOf(expected))
      ) {
        session = null;
      }
      throw error;
    }
    if (session !== null && samePointer(session, pointerOf(expected))) {
      session = { ...session, revision: next.revision };
    }
    channel?.postMessage({
      kind: 'vault-mutate',
      key: vaultNameComparisonKey(expected.vaultName),
    });
    return next;
  }

  return {
    async unlock(vaultName: string, password: string): Promise<VaultServiceStatus> {
      if (session !== null) await lock();
      const record = await requireRecord(vaultName);
      const kek = await deriveVaultKek(password, decodeBase64Url(record.salt));
      try {
        await authenticate(record, kek);
        const current = await requireRecord(record.vaultName);
        if (current.createdAt !== record.createdAt || current.revision !== record.revision) {
          throw sessionStale();
        }
        session = pointerOf(current);
        return statusOf(session);
      } finally {
        kek.fill(0);
      }
    },

    lock,

    async getStatus(): Promise<VaultServiceStatus> {
      if (session === null) {
        return { locked: true, vaultName: null, revision: null, lockEpoch: null };
      }
      return statusOf((await requireFreshSession()).session);
    },

    async getAccounts(vaultName?: string): Promise<VaultAccountSummary[]> {
      const record = await resolveRecord(vaultName);
      return record.accounts.map((account) => ({
        accountName: account.accountName,
        keys: (['owner', 'active', 'posting', 'memo'] as const).flatMap((role) =>
          account.keys[role].map((key) => ({ role, iv: key.iv, note: key.note })),
        ),
        balances: null,
      }));
    },

    async getEnvelope(vaultName?: string): Promise<VaultEnvelopeV1> {
      return vaultRecordToEnvelope(await resolveRecord(vaultName));
    },

    getRecordSnapshot(vaultName?: string): Promise<VaultRecordV1> {
      return resolveRecord(vaultName);
    },

    async assertRecordCurrent(pointer: VaultRevisionPointer): Promise<void> {
      const current = await registry.getRecord(pointer.vaultName);
      if (current === null || !samePointer(pointerOf(current), pointer)) throw sessionStale();
    },

    commitAccounts,

    async addKey(input: VaultKeyInput): Promise<VaultRecordV1> {
      const check = validateVaultWif(input.privateKey, input.accountName);
      if (!['owner', 'active', 'posting', 'memo'].includes(input.role)) {
        throw new VaultError('VAULT_KEY_INVALID', 'key role is not supported');
      }
      const accountName = normalizeSteemUsername(check.accountName);
      const record = await requireRecord(input.vaultName);
      const kek = await deriveVaultKek(input.password, decodeBase64Url(record.salt));
      try {
        await authenticate(record, kek);
        const accounts = cloneAccounts(record.accounts);
        let account = accounts.find(
          (candidate) => normalizeSteemUsername(candidate.accountName) === accountName,
        );
        if (!account) {
          account = { accountName, keys: emptyVaultRoleKeys() };
          accounts.push(account);
        }
        for (const existing of account.keys[input.role]) {
          const wif = await decryptVaultKey(
            kek,
            decodeBase64Url(existing.iv),
            decodeBase64Url(existing.ciphertext),
          );
          if (validateVaultWif(wif, accountName).publicKey === check.publicKey) return record;
        }
        const encrypted = await encryptVaultKeyRecord(
          kek,
          input.privateKey,
          input.note,
          usedIvs(record),
        );
        account.keys[input.role].push(encrypted);
        return await commitAccounts(record, accounts);
      } finally {
        kek.fill(0);
        input.privateKey = '';
        input.password = '';
      }
    },

    async removeKey(pointer: VaultKeyPointer): Promise<VaultRecordV1> {
      const record = await requireRecord(pointer.vaultName);
      const accountName = normalizeSteemUsername(pointer.accountName);
      const accounts = cloneAccounts(record.accounts);
      const account = accounts.find(
        (candidate) => normalizeSteemUsername(candidate.accountName) === accountName,
      );
      const index = account?.keys[pointer.role].findIndex((key) => key.iv === pointer.keyIv) ?? -1;
      if (!account || index < 0) {
        throw new VaultError('VAULT_KEY_INVALID', 'the selected encrypted key does not exist');
      }
      account.keys[pointer.role].splice(index, 1);
      const hasKeys = (['owner', 'active', 'posting', 'memo'] as const).some(
        (role) => (account.keys[role]?.length ?? 0) > 0,
      );
      const nextAccounts = hasKeys
        ? accounts
        : accounts.filter((candidate) => candidate !== account);
      return commitAccounts(record, nextAccounts);
    },

    async updateKeyNote(pointer: VaultKeyPointer, note: string): Promise<VaultRecordV1> {
      const record = await requireRecord(pointer.vaultName);
      const accountName = normalizeSteemUsername(pointer.accountName);
      const accounts = cloneAccounts(record.accounts);
      const key = accounts
        .find((candidate) => normalizeSteemUsername(candidate.accountName) === accountName)
        ?.keys[pointer.role].find((candidate) => candidate.iv === pointer.keyIv);
      if (!key) throw new VaultError('VAULT_KEY_INVALID', 'the selected encrypted key does not exist');
      key.note = note;
      return commitAccounts(record, accounts);
    },

    destroy(): void {
      session = null;
      channel?.close();
      channel = null;
    },
  };
}
