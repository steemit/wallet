'use client';

// Add-key dialog (R2) — the ONLY place outside the vault's internal
// primitives where a WIF may exist, and only as transient form state.
//
// Flow: local validateVaultWif (WIF -> public key; the WIF never leaves this
// component) -> verifyKeysOnChain (ONE batched fresh accounts query; only the
// PUBLIC key and the account name are involved) -> render the verification
// result (matched level / weight / threshold, sub-threshold and not-on-chain
// WARNINGS — both still allow storage per the R2 ruling: the vault is
// storage, not proof of authority; a key the chain places on a DIFFERENT
// level than the selected role is also a warning, since it is stored under
// the selected role regardless) -> explicit confirm -> manager.addKey
// (idempotent on (accountName, role, publicKey); the service detects the
// duplicate by decrypting the role's existing keys and skips the write).
//
// Duplicate UX: the service's no-op leaves the public directory unchanged,
// so the dialog snapshots the (account, role) key count before the call and
// reports "already stored" when the count did not grow. (A concurrent
// same-role write from another tab in that window can mislabel the banner —
// cosmetic only, the storage outcome is identical.)
//
// WIF discipline: cleared on success, on cancel and on unmount; it never
// reaches Redux, logs, analytics or the network. The vault password is used
// for that one encryption only. The form mounts only while the dialog is
// open (Radix unmounts closed content), so a closed dialog holds no WIF.
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { modalFormActionButtonClassName } from '@/components/ui/modal-form-actions';
import { VaultError } from '@/lib/vault/errors';
import {
  verifyKeysOnChain,
  type VaultKeyChainMatch,
} from '@/lib/vault/key-management';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultAccountSummary, VaultKeyRole } from '@/lib/vault/types';
import { validateVaultWif } from '@/lib/vault/validation';
import { normalizeSteemUsername } from '@/lib/steem/username';

const ROLE_OPTIONS: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

const ROLE_LABEL_KEYS: Record<VaultKeyRole, string> = {
  owner: 'keysRoleOwner',
  active: 'keysRoleActive',
  posting: 'keysRolePosting',
  memo: 'keysRoleMemo',
};

/** The verification snapshot shown between the check and the confirm. */
interface ImportKeyFormVerification {
  accountName: string;
  role: VaultKeyRole;
  publicKey: string;
  result: VaultKeyChainMatch;
}

export type AddKeyOutcome = 'keyAdded' | 'keyAlreadyExists';

export interface ImportKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vault that will receive the key (display name). */
  vaultName: string;
  manager: VaultManagerExtended | null;
  /** Called with the storage outcome after a successful (or no-op) add. */
  onAdded: (outcome: AddKeyOutcome) => void;
}

export function ImportKeyDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onAdded,
}: ImportKeyDialogProps) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addKeyTitle', { name: vaultName })}</DialogTitle>
          <DialogDescription>{t('addKeyDescription')}</DialogDescription>
        </DialogHeader>
        {open && (
          <ImportKeyForm
            vaultName={vaultName}
            manager={manager}
            onAdded={(outcome) => {
              onAdded(outcome);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function countRoleKeys(
  accounts: VaultAccountSummary[],
  accountName: string,
  role: VaultKeyRole,
): number {
  // Account names compare through the shared canonical normalization (repo
  // rule: never a raw `===` on usernames) — both sides are normalized
  // already today (directory names by the service, the verified name by
  // validateVaultWif), but the comparison must not depend on that.
  const wanted = normalizeSteemUsername(accountName);
  return (
    accounts
      .find((account) => normalizeSteemUsername(account.accountName) === wanted)
      ?.keys.filter((key) => key.role === role).length ?? 0
  );
}

function ImportKeyForm({
  vaultName,
  manager,
  onAdded,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onAdded: (outcome: AddKeyOutcome) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [accountName, setAccountName] = useState('');
  const [role, setRole] = useState<VaultKeyRole>('posting');
  const [wif, setWif] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [verification, setVerification] = useState<{
    accountName: string;
    role: VaultKeyRole;
    publicKey: string;
    result: VaultKeyChainMatch;
  } | null>(null);

  // Unmount (dialog closed/cancelled) scrubs the sensitive transient state —
  // belt and braces on top of React discarding unmounted state; documents
  // that a closed dialog never holds a WIF or password.
  useEffect(() => {
    return () => {
      setWif('');
      setPassword('');
      setVerification(null);
    };
  }, []);

  const scrubSecrets = () => {
    setWif('');
    setPassword('');
    setVerification(null);
  };

  const formError = (error: unknown) => {
    if (error instanceof VaultError) {
      setErrorKey(`errors.${error.code}`);
    } else {
      console.error('Unexpected add-key error', error);
      setErrorKey('errors.unexpected');
    }
  };

  // note needs no emptiness check (optional) and is capped by maxLength.
  const canVerify = accountName.trim() !== '' && wif !== '' && password !== '' && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || busy) return;
    if (verification === null) {
      if (!canVerify) return;
      setBusy(true);
      setErrorKey(null);
      try {
        // Local WIF validation derives the public key; the WIF itself stays
        // in this component's state. verifyKeysOnChain receives only the
        // public key and the account name.
        const check = validateVaultWif(wif, accountName);
        const [result] = await verifyKeysOnChain([
          { accountName: check.accountName, role, publicKey: check.publicKey },
        ]);
        if (!result) throw new VaultError('VAULT_KEY_INVALID', 'verification returned no result');
        setVerification({ accountName: check.accountName, role, publicKey: check.publicKey, result });
      } catch (error) {
        formError(error);
      } finally {
        setBusy(false);
      }
      return;
    }
    // Confirm path: store the verified key.
    setBusy(true);
    setErrorKey(null);
    try {
      const before = await manager.getAccounts(vaultName);
      const beforeCount = countRoleKeys(before, verification.accountName, verification.role);
      await manager.addKey({
        vaultName,
        accountName: verification.accountName,
        role: verification.role,
        privateKey: wif,
        note,
        password,
      });
      const after = await manager.getAccounts(vaultName);
      const afterCount = countRoleKeys(after, verification.accountName, verification.role);
      onAdded(afterCount > beforeCount ? 'keyAdded' : 'keyAlreadyExists');
      scrubSecrets();
    } catch (error) {
      formError(error);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    scrubSecrets();
    onCancel();
  };

  const roleLabel = (value: VaultKeyRole): string => t(ROLE_LABEL_KEYS[value]);

  interface VerificationVerdict {
    tone: 'ok' | 'warn';
    key: string;
    values: Record<string, string>;
  }

  /**
   * Which i18n message (and tone) renders this verification result. Order
   * matters — the most consequential finding wins:
   *   1. not on chain                      -> warn (stored, cannot sign);
   *   2. matched but sub-threshold         -> warn (signer will reject it);
   *   3. matched on a DIFFERENT level than the selected role (e.g. memo
   *      selected, posting matched)        -> warn: the key is stored under
   *      the SELECTED role but acts on chain only as what it really is — a
   *      green "verified" here would read as "stored where it belongs";
   *   4. memo match                        -> ok (encrypts memos, never signs);
   *   5. matched, sufficient weight        -> ok.
   */
  const verdictOf = (candidate: ImportKeyFormVerification): VerificationVerdict => {
    const { result } = candidate;
    if (!result.matched) {
      return { tone: 'warn', key: 'verifyNotOnChain', values: {} };
    }
    if (!result.suffices) {
      return {
        tone: 'warn',
        key: 'verifySubthreshold',
        values: {
          authority: roleLabel(result.authority),
          weight: String(result.weight),
          threshold: String(result.threshold),
        },
      };
    }
    if (result.authority !== candidate.role) {
      return {
        tone: 'warn',
        key: 'verifyAuthorityDiffers',
        values: {
          authority: roleLabel(result.authority),
          role: roleLabel(candidate.role),
        },
      };
    }
    if (result.authority === 'memo') {
      return { tone: 'ok', key: 'verifyMemo', values: {} };
    }
    return {
      tone: 'ok',
      key: 'verifyMatched',
      values: {
        authority: roleLabel(result.authority),
        weight: String(result.weight),
        threshold: String(result.threshold),
      },
    };
  };

  const verdict = verification !== null ? verdictOf(verification) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="vault-add-key-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-add-key-account">{t('addKeyAccountLabel')}</Label>
        <Input
          id="vault-add-key-account"
          value={accountName}
          onChange={(event) => {
            setAccountName(event.target.value);
            setVerification(null);
          }}
          placeholder={t('addKeyAccountPlaceholder')}
          disabled={busy}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-add-key-role">{t('addKeyRoleLabel')}</Label>
        <select
          id="vault-add-key-role"
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as VaultKeyRole);
            setVerification(null);
          }}
          disabled={busy}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {roleLabel(option)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-add-key-wif">{t('addKeyWifLabel')}</Label>
        <Input
          id="vault-add-key-wif"
          type="password"
          autoComplete="off"
          value={wif}
          onChange={(event) => {
            setWif(event.target.value);
            setVerification(null);
          }}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-add-key-note">{t('addKeyNoteLabel')}</Label>
        <Input
          id="vault-add-key-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={256}
          disabled={busy}
        />
        <p className="text-muted-foreground text-xs">{t('addKeyNoteWarning')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-add-key-password">{t('addKeyPasswordLabel')}</Label>
        <Input
          id="vault-add-key-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {verdict !== null && (
        <div
          className={
            verdict.tone === 'ok'
              ? 'rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3'
              : 'rounded-md border border-amber-500/40 bg-amber-500/10 p-3'
          }
          data-testid="vault-add-key-verification"
        >
          <p
            className={
              verdict.tone === 'ok'
                ? 'flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400'
                : 'flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400'
            }
          >
            {verdict.tone === 'ok' ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            {t(verdict.key, verdict.values)}
          </p>
        </div>
      )}
      {errorKey && (
        <p className="text-destructive text-sm font-medium" role="alert">
          {t(errorKey)}
        </p>
      )}
      <DialogFooter>
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={verification === null ? cancel : () => setVerification(null)}
            disabled={busy}
            className={modalFormActionButtonClassName}
          >
            {verification === null ? t('cancelAction') : t('addKeyEditAgain')}
          </Button>
          <Button
            type="submit"
            disabled={verification === null ? !canVerify : busy}
            className={modalFormActionButtonClassName}
            data-testid="vault-add-key-primary"
          >
            {busy
              ? verification === null
                ? t('addKeyVerifying')
                : t('addKeyAdding')
              : verification === null
                ? t('addKeyVerifyButton')
                : t('addKeyConfirmButton')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
