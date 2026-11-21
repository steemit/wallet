// Plaintext migration (A6-T5): move the device-remembered posting key from
// localStorage into the encrypted vault, deleting the plaintext ONLY after a
// verified readback. This module holds the deletion gate — the hard line from
// the A6 kickoff (progress doc "A6 开工注意事项" items 2 and 4):
//
//   the localStorage plaintext is deleted ONLY after
//   (a) the key was written into the vault (encrypted, fresh IV — that is
//       `service.addKey` -> `encryptVaultKeyRecord`, which mints a vault-unique
//       IV and authenticates the password against the vault's first key),
//   (b) the vault record was RE-READ from the registry (`service
//       .getRecordSnapshot(vaultName)` resolves through `registry.getRecord` —
//       a fresh IndexedDB read, never the in-memory record the write path
//       returned), and
//   (c) the specific stored key entry was AUTHENTICALLY DECRYPTED (AES-GCM
//       authentication success under the KEK derived from the vault password
//       and the RE-READ record's salt) AND the public key derived from the
//       decrypted WIF equals the public key derived from the remembered key
//       at flow start.
//
//   Write success alone NEVER triggers deletion. UI code must not re-implement
//   this gate (or call clearRememberedPostingKey on its own): the ONLY
//   deletion call in the migration flow lives at the bottom of
//   migrateRememberedPostingKey.
//
// Idempotency / partial states: every failure leaves the plaintext untouched.
// A partial success (key written, readback failed) leaves the key in the vault
// AND the plaintext on the device; re-running the flow rides `service.addKey`'s
// duplicate no-op (dedupe on (accountName, role, publicKey)), then verifies and
// deletes — the second run reports `alreadyPresent`. The dedupe outcome is
// detected by comparing the record revision before/after `addKey` (a no-op
// returns the unchanged record), the same class of cosmetic race the add-key
// dialog documents for its count-based detection; the storage outcome is
// identical either way.
//
// What stays: the remembered USERNAME is NOT deleted. It is a public account
// name (the chain publishes it), it keeps the classic login prefill and the
// remembered-username redirect working after the user switches the device mode
// back to privateKey, and deleting it would degrade that UX with zero security
// gain. Only the WIF — the secret — moves.
//
// SENSITIVE-DATA RULES (invariant 7): the WIF exists only inside this
// operation's scope (read from localStorage, handed to service.addKey,
// transiently decrypted again for the readback verification). The password
// exists only as an in-scope argument. Neither is ever logged, embedded in an
// error message, or persisted anywhere but the vault ciphertext.
// `readRememberedPostingKeyCandidate` deliberately returns PUBLIC data only
// (account name + derived public key) so UI components never hold the WIF.
import { decodeBase64Url } from './envelope';
import { decryptVaultKey, deriveVaultKek } from './crypto';
import { VaultError } from './errors';
import type { VaultService } from './service';
import type { VaultRecordV1 } from './types';
import { validateVaultWif } from './validation';
import { normalizeSteemUsername } from '@/lib/steem/username';
import {
  clearRememberedPostingKey,
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';

/**
 * Fixed note stamped on the migrated key entry. Stored data, not UI copy —
 * English by design (like every stored note it renders as-is in every
 * locale; baking the migration-time locale into persisted data would make
 * the entry's provenance depend on where the user migrated).
 */
export const MIGRATED_KEY_NOTE = "Migrated from the device's remembered posting key";

/** PUBLIC: everything the migration UI needs to describe/verify the key. */
export interface RememberedKeyCandidate {
  accountName: string;
  publicKey: string;
}

/**
 * Read the device-remembered posting key and derive its PUBLIC description:
 * the normalized account name (from the remembered username) and the public
 * key derived from the WIF. Returns `null` when nothing is remembered or the
 * remembered pair does not validate (missing username, malformed WIF,
 * invalid account name). NEVER returns, logs or exposes the WIF itself —
 * callers render the candidate without ever touching key material.
 */
export function readRememberedPostingKeyCandidate(): RememberedKeyCandidate | null {
  if (typeof window === 'undefined') return null;
  try {
    const wif = localStorage.getItem(REMEMBERED_POSTING_KEY_KEY);
    const username = localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (!wif || !username) return null;
    const check = validateVaultWif(wif, username);
    return { accountName: check.accountName, publicKey: check.publicKey };
  } catch {
    // Missing/unresolvable/malformed remembered data is "nothing to migrate".
    return null;
  }
}

export interface MigrateRememberedKeyInput {
  /** Vault that receives the key (display name). */
  vaultName: string;
  /**
   * The account the UI verified against the chain (normalized). The run
   * re-reads localStorage and REFUSES (VAULT_KEY_INVALID) when the remembered
   * key no longer belongs to this account — what was verified on chain must
   * be exactly what is stored.
   */
  expectedAccountName: string;
  /**
   * The public key the UI derived from the remembered WIF and verified on
   * chain. The run refuses when the derivation no longer matches.
   */
  expectedPublicKey: string;
  /** Vault password for the target vault (SENSITIVE, transient). */
  password: string;
  /** Note for the stored entry; defaults to {@link MIGRATED_KEY_NOTE}. */
  note?: string;
}

export interface MigrateRememberedKeyResult {
  /**
   * `migrated`: the vault record advanced (fresh ciphertext written).
   * `alreadyPresent`: the key was already stored (addKey no-op, dedupe on
   * (accountName, role, publicKey)) — the readback verification ran anyway
   * and the plaintext was deleted after it. Both outcomes are successes.
   */
  outcome: 'migrated' | 'alreadyPresent';
}

function keyInvalid(reason: string): VaultError {
  return new VaultError('VAULT_KEY_INVALID', reason);
}

/** Read the remembered pair from localStorage; throws closed when absent. */
function readRememberedPair(): { wif: string; accountName: string; publicKey: string } {
  if (typeof window === 'undefined') {
    throw keyInvalid('the remembered posting key is not available outside the browser');
  }
  let wif: string | null = null;
  let username: string | null = null;
  try {
    wif = localStorage.getItem(REMEMBERED_POSTING_KEY_KEY);
    username = localStorage.getItem(REMEMBERED_USERNAME_KEY);
  } catch {
    throw keyInvalid('the remembered posting key could not be read from this device');
  }
  if (!wif || !username) {
    throw keyInvalid('the remembered posting key is no longer available on this device');
  }
  const check = validateVaultWif(wif, username);
  return { wif, accountName: check.accountName, publicKey: check.publicKey };
}

/**
 * Scan one account's posting entries for a VERIFIED copy of the expected key:
 * an entry is verified when it authenticates (AES-GCM) under the KEK AND the
 * public key derived from its decrypted WIF equals `expectedPublicKey`.
 * Entries whose outer publicKey field is present and differs are skipped
 * without decryption (the same dedupe optimization the service applies);
 * legacy entries without the field and outer-matching entries are decrypted
 * and checked. Per-entry failures (bad ciphertext, failed validation) skip to
 * the next candidate — the caller fails closed when NO entry verifies.
 * The decrypted WIF never leaves this function's frame.
 */
async function hasVerifiablePostingKey(
  record: VaultRecordV1,
  accountName: string,
  expectedPublicKey: string,
  kek: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const account = record.accounts.find(
    (candidate) => normalizeSteemUsername(candidate.accountName) === accountName,
  );
  if (!account) return false;
  for (const entry of account.keys.posting) {
    if (entry.publicKey !== undefined && entry.publicKey !== expectedPublicKey) continue;
    let wif: string | null = null;
    try {
      wif = await decryptVaultKey(
        kek,
        decodeBase64Url(entry.iv),
        decodeBase64Url(entry.ciphertext),
      );
      if (validateVaultWif(wif, accountName).publicKey === expectedPublicKey) return true;
    } catch {
      // Not a verified copy — keep scanning.
    } finally {
      wif = null;
    }
  }
  return false;
}

/**
 * The verified-readback migration (deletion-gate contract in the module
 * header). Throws (no deletion) on ANY failure; the plaintext survives every
 * failure path. Orchestrated through service primitives only — `addKey`
 * (encrypt + authenticate + CAS) and `getRecordSnapshot` (registry re-read).
 */
export async function migrateRememberedPostingKey(
  deps: { service: VaultService },
  input: MigrateRememberedKeyInput,
): Promise<MigrateRememberedKeyResult> {
  const remembered = readRememberedPair();
  // The flow's chain verification and this run must describe the SAME key:
  // refuse when the remembered pair changed between the dialog's verify step
  // and the confirm (another tab, a login in between, tampering).
  if (
    normalizeSteemUsername(input.expectedAccountName) !== remembered.accountName ||
    input.expectedPublicKey !== remembered.publicKey
  ) {
    throw keyInvalid('the remembered key changed since it was verified');
  }

  // (a) WRITE through the add-key primitive (fresh IV, password
  // authentication, dedupe no-op on (accountName, role, publicKey)).
  const before = await deps.service.getRecordSnapshot(input.vaultName);
  const written = await deps.service.addKey({
    vaultName: input.vaultName,
    accountName: remembered.accountName,
    role: 'posting',
    privateKey: remembered.wif,
    note: input.note ?? MIGRATED_KEY_NOTE,
    password: input.password,
    publicKey: remembered.publicKey,
  });
  const outcome: MigrateRememberedKeyResult['outcome'] =
    written.revision > before.revision ? 'migrated' : 'alreadyPresent';

  // (b) RE-READ from the registry — never the write path's in-memory record.
  const reread = await deps.service.getRecordSnapshot(input.vaultName);

  // (c) AUTHENTICATED DECRYPT + derived-public-key match on the stored entry.
  const kek = await deriveVaultKek(input.password, decodeBase64Url(reread.salt));
  try {
    const verified = await hasVerifiablePostingKey(
      reread,
      remembered.accountName,
      remembered.publicKey,
      kek,
    );
    if (!verified) {
      throw keyInvalid(
        'readback verification failed: the stored entry does not match the remembered key',
      );
    }
    // Deletion gate: reached only after (a) + (b) + (c) all succeeded.
    clearRememberedPostingKey();
    return { outcome };
  } finally {
    kek.fill(0);
    input.password = '';
  }
}
