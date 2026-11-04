// Vault backup export, independent import and merge migration (A3).
//
// Built strictly on the landed A1.1/A2 primitives — no direct IndexedDB
// access, no re-implemented rules:
//   - envelope/payload/password/WIF/account validation comes from the shared
//     entry points (./envelope.ts and ./validation.ts);
//   - persistent writes go through the registry's atomic transactions
//     (`createVault` for alias-uniqueness + insert, `swapRecord` for CAS) and
//     the unlock-session service's `mutatePayload` (fresh IV + whole-payload
//     re-encryption + CAS);
//   - crypto is the fixed A1 profile (./crypto.ts); every incoming backup is
//     envelope-validated, authenticated-decrypted and payload-validated BEFORE
//     any write is attempted.
//
// COMPOSITION NOTE (createVault takes no payload parameter): the A2 registry
// primitive `createVault({ vaultName, password })` always creates a vault with
// the EMPTY payload. Independent import therefore composes three primitives —
// `createVault` (atomic alias uniqueness, fresh salt/IV, policy-gated password)
// → an in-scope service `unlock` → `mutatePayload` (writes the imported
// payload under a second fresh IV with CAS). The composition costs one extra
// PBKDF2 derivation versus a hypothetical payload-accepting create; any
// failure after the create removes the just-created vault again (BOUND to the
// created instance's `createdAt` — see the import JSDoc), so a failed import
// leaves no trace and never touches a concurrent same-name recreation.
//
// SENSITIVE-DATA RULES: source KEKs are zeroized (`fill(0)`) inside the scope
// that derived them and never leave this module; WIFs exist only inside
// payload objects handed to the service mutator, which is vault-internal
// feature code (the docs/AI-driver/09-vault.md invariant 14 mutator boundary
// — never pass component-level callbacks through). Error messages never echo
// vault names, passwords, WIFs, salts, IVs, ciphertext or derived keys.
import { decodeBase64Url, validateVaultEnvelope, validateVaultPayloadText } from './envelope';
import { decryptVaultText, deriveVaultKek } from './crypto';
import { VaultError } from './errors';
import { vaultRecordToEnvelope, type VaultRegistry } from './registry';
import { createVaultService, type VaultService, type VaultServiceStatus } from './service';
import type {
  ImportVaultParams,
  VaultEnvelopeV1,
  VaultKeyEntry,
  VaultKeyRole,
  VaultRecordV1,
} from './types';
import { validateVaultPassword, validateVaultWif } from './validation';

/** Independent-import parameters — the A0 `ImportVaultParams` "independent" branch. */
export type IndependentImportParams = Extract<ImportVaultParams, { mode: 'independent' }>;

/** Merge-migration parameters — the A0 `ImportVaultParams` "merge" branch. */
export type MergeImportParams = Extract<ImportVaultParams, { mode: 'merge' }>;

/**
 * One source-backup key entry after local validation: the stored entry form
 * (normalized account name, original role, WIF) plus the public key derived
 * from the WIF — the derivation is the dedupe identity and is never persisted.
 */
interface SourceKey {
  entry: VaultKeyEntry;
  publicKey: string;
}

/**
 * Export a vault as its backup: EXACTLY the five `VaultEnvelopeV1` fields
 * (`version`, `vaultName`, `salt`, `iv`, `ciphertext`) extracted through
 * `vaultRecordToEnvelope`. Revision, lockEpoch and timestamps are local
 * runtime state and never become part of a backup. The export is read-only on
 * the crypto side: no unlock, no re-encryption, no new IV — the exported
 * ciphertext bytes are exactly the stored ones.
 *
 * After extracting the envelope the export marker `lastBackupAt` (an existing
 * `VaultRecordV1` field) is updated through the registry's CAS primitive
 * (`swapRecord`), which necessarily bumps `revision` (its contract requires
 * +1 per write) — a side effect that invalidates unlocked sessions for this
 * vault in ANY tab, INCLUDING the caller's own service instance: every
 * session-bound operation re-compares the revision and therefore rejects with
 * `VAULT_SESSION_STALE` on the next use. That is the accepted cost of the only
 * mutating primitive the registry exposes, and the envelope fields themselves
 * stay untouched. Wiring note for A4/A5: a flow that exports while unlocked
 * must tolerate re-unlocking afterwards (or lock before exporting). A
 * concurrent change of the record between the read and the swap propagates
 * `VAULT_SESSION_STALE` (or `VAULT_NOT_FOUND` after a removal) per the
 * registry contract — the caller re-reads and retries.
 *
 * Throws `VAULT_NOT_FOUND` when no vault exists under the name. Error messages
 * never echo names or envelope material.
 */
export async function exportVaultBackup(
  registry: VaultRegistry,
  vaultName: string,
): Promise<VaultEnvelopeV1> {
  const record = await registry.getRecord(vaultName);
  if (record === null) {
    throw new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
  }
  const envelope = vaultRecordToEnvelope(record);
  const now = Date.now();
  await registry.swapRecord(
    {
      vaultName: record.vaultName,
      createdAt: record.createdAt,
      revision: record.revision,
      lockEpoch: record.lockEpoch,
    },
    { ...record, revision: record.revision + 1, updatedAt: now, lastBackupAt: now },
  );
  return envelope;
}

/**
 * Authenticate, validate and open a source backup envelope into locally
 * validated, deduplicated key entries (shared by the independent import and
 * the merge migration — kickoff A3 steps 1–3 for both).
 *
 * Steps, in order: fail-closed five-field envelope validation (canonical
 * base64url, lengths, version, ciphertext resource caps) → PBKDF2 KEK
 * derivation from the source salt + password → authenticated AES-GCM decrypt
 * (wrong password / tampering → `VAULT_PASSWORD_INVALID`) → decrypted-payload
 * validation (shape plus the payload resource caps) → per-entry local
 * validation through `validateVaultWif` (real WIF checksum + public-key
 * derivation + `normalizeSteemUsername` account normalization; any failure →
 * `VAULT_KEY_INVALID`, never echoing the value) → dedupe on
 * `(normalized accountName, role, derived publicKey)` keeping the first
 * occurrence. Everything here is offline — a backup's contents are never
 * treated as an on-chain authority proof.
 *
 * The source KEK is zeroized in this scope; only non-KEK material leaves.
 */
async function openBackupEnvelope(
  envelope: VaultEnvelopeV1,
  password: string,
): Promise<SourceKey[]> {
  const valid = validateVaultEnvelope(envelope);
  const kek = await deriveVaultKek(password, decodeBase64Url(valid.salt));
  let payloadText: string;
  try {
    payloadText = await decryptVaultText(
      kek,
      decodeBase64Url(valid.iv),
      decodeBase64Url(valid.ciphertext),
    );
  } finally {
    kek.fill(0);
  }
  const payload = validateVaultPayloadText(payloadText);
  const seen = new Set<string>();
  const keys: SourceKey[] = [];
  for (const entry of payload.keys) {
    const check = validateVaultWif(entry.privateKey, entry.accountName);
    const key = sourceDedupeKey(check.accountName, entry.role, check.publicKey);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push({
      entry: {
        accountName: check.accountName,
        role: entry.role,
        privateKey: entry.privateKey,
      },
      publicKey: check.publicKey,
    });
  }
  return keys;
}

/** Dedupe identity of a key entry: normalized account + role + derived public key. */
function sourceDedupeKey(accountName: string, role: VaultKeyRole, publicKey: string): string {
  // None of the three fields can contain NUL (account names are [a-z0-9.-],
  // roles come from the fixed vocabulary, STM public keys are base58), so a
  // NUL separator cannot introduce collisions.
  return `${accountName}\u0000${role}\u0000${publicKey}`;
}

/**
 * Import a backup as a NEW, independent vault (kickoff A3 "independent" mode).
 *
 * Input contract: text backups must be parsed through
 * `parseVaultEnvelopeJson` first (the raw-JSON 1 MiB gate lives in that entry
 * point); this function takes an already-parsed `VaultEnvelopeV1` object.
 *
 * Single-password contract (A0 `ImportVaultParams`): `params.password` is BOTH
 * the source backup's password (it authenticates the decryption) AND the
 * password the new vault will keep — import does not offer a separate
 * new-password field. Because importing CREATES a new record, the strength
 * policy applies to that password here (`VAULT_PASSWORD_WEAK` on failure).
 * This does not contradict the "policy never gates unlocking" rule: the
 * source backup itself decrypts fine under its existing password — a weak
 * backup's remedy is UI guidance (A5), this layer simply refuses to create a
 * new vault protected by a weak password.
 *
 * Flow: open + validate + locally validate + dedupe the source (see
 * {@link openBackupEnvelope}) → password policy (BEFORE any registry write;
 * `createVault` re-validates as defense in depth) → `createVault` under the
 * NEW local name (name conflicts/invalid names surface from the registry's
 * atomic alias-uniqueness transaction as `VAULT_NAME_EXISTS` /
 * `VAULT_NAME_INVALID`; a fresh salt/IV is minted inside) → an in-scope
 * service unlock → an INSTANCE-BOUND ADOPTION CHECK (see
 * {@link assertCreatedInstanceCurrent}: before any write, the record under
 * the created name must still be the instance this import created) → a
 * `mutatePayload` write of the normalized, deduplicated payload
 * (whole-payload encryption under a second fresh IV, revision 1, CAS) → an
 * instance-bound final read-back.
 *
 * INSTANCE BINDING (A3 review r2): the create→unlock gap spans a ~1s PBKDF2
 * derivation, during which another tab may remove the just-created vault and
 * recreate the SAME name. `VaultServiceStatus` exposes no `createdAt`, so an
 * unlock that (legitimately, by name) adopted the replacement record is
 * indistinguishable from the session the import intended — the adoption
 * check compares the stored record's `createdAt` against the created one and
 * rejects with `VAULT_SESSION_STALE` BEFORE any write, so the source payload
 * can never land in another tab's rebuilt vault.
 *
 * ROLLBACK (any failure after the create): best-effort AND instance-bound —
 * see {@link rollbackCreatedVault}. The just-created vault is removed again
 * so a failed import leaves no trace, but ONLY when the record under the
 * name is still the created instance (same name + `createdAt`); a concurrent
 * same-name recreation is never deleted. A removal failure would leave an
 * EMPTY, harmless vault while the primary error wins.
 *
 * The import NEVER activates the vault (`settings.activeVaultName` is not
 * touched — activation is the A4 manager's explicit act). Returns the final
 * stored record (revision 1, `lastBackupAt: null`).
 */
export async function importVaultBackup(
  registry: VaultRegistry,
  params: IndependentImportParams,
): Promise<VaultRecordV1> {
  const source = await openBackupEnvelope(params.envelope, params.password);
  validateVaultPassword(params.password);
  const service = createVaultService(registry);
  try {
    const created = await registry.createVault({
      vaultName: params.vaultName,
      password: params.password,
    });
    try {
      await service.unlock(created.vaultName, params.password);
      await assertCreatedInstanceCurrent(registry, created);
      await service.mutatePayload((draft) => {
        draft.keys = source.map(({ entry }) => ({ ...entry }));
      });
    } catch (error) {
      await rollbackCreatedVault(registry, created);
      throw error;
    }
    const record = await registry.getRecord(created.vaultName);
    if (record === null || record.createdAt !== created.createdAt) {
      throw createdInstanceReplaced();
    }
    return record;
  } finally {
    service.destroy();
  }
}

/** The stored record under the created name is not the created instance. */
function createdInstanceReplaced(): VaultError {
  return new VaultError(
    'VAULT_SESSION_STALE',
    'the vault created by this import is no longer the stored instance',
  );
}

/** Whether a record is the exact instance this import created. */
function isCreatedInstance(current: VaultRecordV1, created: VaultRecordV1): boolean {
  // `createdAt` is the record's instance identity (registry invariant): a
  // same-name remove+recreate restarts the counters but not the timestamp.
  // The name comparison is implied by the name-keyed lookup but kept explicit.
  return current.vaultName === created.vaultName && current.createdAt === created.createdAt;
}

/**
 * Instance-bound adoption check between the in-scope unlock and the payload
 * write: the record under the created name must still be the instance this
 * import created. `service.unlock` looks the vault up BY NAME, so when
 * another tab removed the just-created vault and recreated the same name
 * during the create→unlock gap, the unlock legitimately adopted the
 * REPLACEMENT record (same password + the replacement's fresh salt decrypt
 * fine — unlock's own born-stale check cannot see the swap either, because
 * the replacement was already stored before unlock's first read). The
 * service status exposes no `createdAt` to compare directly, so the record
 * is re-read here; a mismatch throws `VAULT_SESSION_STALE` and the import
 * rolls back without writing. `mutatePayload`'s hard-line check remains the
 * backstop for swaps that land AFTER this check.
 */
async function assertCreatedInstanceCurrent(
  registry: VaultRegistry,
  created: VaultRecordV1,
): Promise<void> {
  const current = await registry.getRecord(created.vaultName);
  if (current === null || !isCreatedInstance(current, created)) {
    throw createdInstanceReplaced();
  }
}

/**
 * Best-effort rollback of a failed import, BOUND TO THE CREATED INSTANCE:
 * re-read the record under the created name and remove it ONLY when it is
 * still the instance this import created (same name + `createdAt`). When a
 * different instance is stored there — another tab's remove+recreate already
 * replaced ours — the rollback STANDS DOWN: deleting by bare name here would
 * destroy the other tab's rebuilt vault (A3 review r2), so the primary error
 * propagates untouched and the replacement survives. When NO record is
 * visible the removal is still attempted (an absent record is not a positive
 * replacement signal; `VAULT_NOT_FOUND` is swallowed) and any removal
 * failure leaves an EMPTY, harmless vault while the primary error wins.
 *
 * The read→delete pair is not atomic (the registry deliberately offers no
 * conditional remove); the check shrinks the cross-deletion window from the
 * whole PBKDF2 gap to the sub-millisecond span between these two calls.
 */
async function rollbackCreatedVault(
  registry: VaultRegistry,
  created: VaultRecordV1,
): Promise<void> {
  try {
    const current = await registry.getRecord(created.vaultName);
    if (current !== null && !isCreatedInstance(current, created)) {
      return; // replaced by a concurrent same-name recreate — stand down
    }
    await registry.removeVault(created.vaultName);
  } catch {
    // Best-effort by contract: the primary error wins.
  }
}

/**
 * Merge a backup's keys into an EXISTING vault (kickoff A3 "merge" mode).
 * The target must be unlocked in THIS service instance under its NFC display
 * name — a locked service or a name mismatch rejects with `VAULT_LOCKED`
 * (`getStatus()` is itself a session-bound hard-line operation, so a stale
 * session propagates `VAULT_SESSION_STALE` before anything else).
 *
 * Flow:
 *   1. Auto-backup the target first: the pre-merge five-field envelope is
 *      snapshotted and returned as `preMergeBackup` (the "internal safety
 *      net"). It is NOT persisted and deliberately does NOT update
 *      `lastBackupAt` — that marker belongs to user-initiated exports via
 *      {@link exportVaultBackup} only.
 *   2. Open + validate + dedupe the source exactly like the independent
 *      import. The source password ONLY decrypts the backup — the merge
 *      writes into an existing vault and sets no new password, so the
 *      strength policy deliberately does NOT run here.
 *   3. Merge inside the service mutator (vault-internal feature code —
 *      invariant 14): flat `keys` array, deduped on
 *      `(normalized accountName, role, derived publicKey)`; on a conflict the
 *      TARGET entry wins (target-first iteration; the target's raw spelling
 *      and entry order are preserved, source entries are stored normalized).
 *      Target entries are re-validated through `validateVaultWif` — an
 *      invalid target entry aborts the merge with `VAULT_KEY_INVALID` and
 *      nothing is written.
 *   4. `mutatePayload` validates the merged result (`VAULT_LIMIT_EXCEEDED`
 *      when the 400-keys / 100-accounts / payload-size bounds are crossed —
 *      the target is not touched), then persists under the TARGET's KEK with
 *      a fresh IV and CAS. Any failure — validation, mutator throw, CAS drift
 *      — leaves the stored target ciphertext byte-identical; there is no
 *      partial-write path. The target alias, salt and `lastBackupAt` are
 *      untouched by construction, and nothing is activated. A merge that
 *      changes nothing (an EMPTY `{"keys":[]}` source, or one whose entries
 *      all conflict with the target's) is still a REWRITE, not a no-op: the
 *      record comes back under a fresh IV with revision +1. There is
 *      deliberately no equality short-circuit — one unconditional write path
 *      keeps the primitive simple and the CAS semantics uniform.
 */
export async function mergeVaultBackup(
  registry: VaultRegistry,
  service: VaultService,
  params: MergeImportParams,
): Promise<VaultMergeResult> {
  const status = await service.getStatus();
  const targetName = params.targetVaultName.normalize('NFC');
  if (status.locked || status.vaultName !== targetName) {
    throw new VaultError('VAULT_LOCKED', 'the target vault is not unlocked in this session');
  }
  const record = await registry.getRecord(status.vaultName);
  if (record === null) {
    throw new VaultError('VAULT_NOT_FOUND', 'no vault exists under that name');
  }
  const preMergeBackup = vaultRecordToEnvelope(record);
  const source = await openBackupEnvelope(params.envelope, params.password);
  const merged = await service.mutatePayload((draft) => {
    draft.keys = mergeKeyEntries(draft.keys, source);
  });
  return { status: merged, preMergeBackup };
}

/** Result of a successful {@link mergeVaultBackup}. */
export interface VaultMergeResult {
  /** The service's session status after the merged write. */
  status: VaultServiceStatus;
  /**
   * The pre-merge five-field envelope of the target (the internal safety
   * net). Memory-only on this layer: never persisted by the merge and it does
   * NOT update `lastBackupAt` — callers may keep it (or offer it as a file)
   * as the pre-merge recovery point. On any merge failure the stored target
   * ciphertext is untouched regardless.
   */
  preMergeBackup: VaultEnvelopeV1;
}

/**
 * Union of the target's current entries and the validated source entries on
 * the flat `keys` array, deduped on `(normalized accountName, role, derived
 * publicKey)`. TARGET entries are iterated first and win conflicts — the
 * target is the live vault being merged INTO; source entries only fill gaps.
 * Both sides are validated through the shared `validateVaultWif` entry point
 * (a failure throws `VAULT_KEY_INVALID`; when called inside a
 * `mutatePayload` mutator that means nothing is written).
 */
function mergeKeyEntries(target: VaultKeyEntry[], source: SourceKey[]): VaultKeyEntry[] {
  const seen = new Set<string>();
  const merged: VaultKeyEntry[] = [];
  for (const entry of target) {
    const check = validateVaultWif(entry.privateKey, entry.accountName);
    const key = sourceDedupeKey(check.accountName, entry.role, check.publicKey);
    if (seen.has(key)) {
      continue; // collapse accidental target-internal duplicates
    }
    seen.add(key);
    merged.push({ ...entry });
  }
  for (const { entry, publicKey } of source) {
    const key = sourceDedupeKey(entry.accountName, entry.role, publicKey);
    if (seen.has(key)) {
      continue; // conflict: the target entry above wins
    }
    seen.add(key);
    merged.push({ ...entry });
  }
  return merged;
}
