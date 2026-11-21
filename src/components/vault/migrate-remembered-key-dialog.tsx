'use client';

// Migrate-remembered-key dialog (A6-T5) — the explicit, user-initiated flow
// that moves the device-remembered posting key from localStorage plaintext
// into the encrypted vault. NO auto-migration exists anywhere: this dialog is
// the only entry, opened from the vault key manager's button (which renders
// only while a valid remembered pair exists on the device).
//
// WIF DISCIPLINE (stricter than the add-key dialog): the component NEVER
// holds the WIF. `readRememberedPostingKeyCandidate` returns PUBLIC data only
// (account name + derived public key); the remembered WIF stays in
// localStorage until the orchestration primitive re-reads it inside the
// deletion-gated operation. The only sensitive value in component state is
// the typed vault password — scrubbed on success, cancel and unmount (the
// import-key-dialog discipline), never in Redux, logs, analytics or the
// network.
//
// Flow: confirmation copy (what moves where, the device plaintext removal,
// the claim-banner consequence, the username staying) + vault password ->
// verifyKeysOnChain on the PUBLIC candidate (the same ONE batched fresh
// query + verdict semantics as R2's add-key dialog, rendered through the
// shared KeyVerdictBox) -> explicit "Migrate now" ->
// manager.migrateRememberedPostingKey (write -> registry re-read ->
// authenticated decrypt -> only then delete the plaintext; see
// lib/vault/migration.ts). Any failure maps to `vault.errors.<CODE>` and
// leaves the plaintext untouched; the flow is re-runnable (a duplicate key
// rides addKey's dedupe no-op and reports `alreadyPresent`).
//
// Target-vault selection: the dialog migrates into the vault whose key
// manager opened it — entering that vault's key manager IS the selection
// (deliberately no in-dialog vault selector; document, don't complicate).
// The remembered key's ACCOUNT may differ from any active session: the
// migration targets the remembered account, and the vault password belongs
// to the TARGET vault, not to any session identity.
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

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
import { shortPublicKey } from './vault-key-manager';
import { KeyVerdictBox, type VaultKeyVerification } from './key-verdict';
import { VaultError } from '@/lib/vault/errors';
import { verifyKeysOnChain } from '@/lib/vault/key-management';
import {
  readRememberedPostingKeyCandidate,
  type RememberedKeyCandidate,
} from '@/lib/vault/migration';
import type { VaultManagerExtended } from '@/lib/vault/manager';

export type MigrateRememberedKeyOutcome = 'migrated' | 'alreadyPresent';

export interface MigrateRememberedKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vault that receives the key (display name). */
  vaultName: string;
  manager: VaultManagerExtended | null;
  /** Called with the outcome after the plaintext was verified and deleted. */
  onMigrated: (outcome: MigrateRememberedKeyOutcome) => void;
}

export function MigrateRememberedKeyDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onMigrated,
}: MigrateRememberedKeyDialogProps) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('migrateTitle')}</DialogTitle>
          <DialogDescription>{t('migrateDescription', { name: vaultName })}</DialogDescription>
        </DialogHeader>
        {open && (
          <MigrateRememberedKeyForm
            vaultName={vaultName}
            manager={manager}
            onMigrated={(outcome) => {
              onMigrated(outcome);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MigrateRememberedKeyForm({
  vaultName,
  manager,
  onMigrated,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onMigrated: (outcome: MigrateRememberedKeyOutcome) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  // undefined = reading the device state; null = nothing valid remembered.
  const [candidate, setCandidate] = useState<RememberedKeyCandidate | null | undefined>(undefined);
  const [candidateLoaded, setCandidateLoaded] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [verification, setVerification] = useState<VaultKeyVerification | null>(null);

  // Read the remembered pair's PUBLIC description once per mount (Radix
  // unmounts closed content, so every open re-reads the device state).
  useEffect(() => {
    // Defer past the effect body (the panel's established pattern).
    void Promise.resolve().then(() => {
      setCandidate(readRememberedPostingKeyCandidate());
      setCandidateLoaded(true);
    });
    return () => {
      // Unmount (dialog closed/cancelled) scrubs the sensitive transient
      // state — a closed dialog holds no password.
      setPassword('');
      setVerification(null);
    };
  }, []);

  const scrubSecrets = () => {
    setPassword('');
    setVerification(null);
  };

  const formError = (error: unknown) => {
    if (error instanceof VaultError) {
      setErrorKey(`errors.${error.code}`);
    } else {
      console.error('Unexpected migrate-remembered-key error', error);
      setErrorKey('errors.unexpected');
    }
  };

  // Nothing (valid) remembered anymore: the entry point should not have been
  // offered, but fail visibly instead of pretending — dismiss-only state.
  if (candidateLoaded && candidate === null) {
    return (
      <div className="flex flex-col gap-3" data-testid="vault-migrate-form">
        <p className="text-muted-foreground text-sm">{t('migrateMissing')}</p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className={modalFormActionButtonClassName}
          >
            {t('cancelAction')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const canVerify =
    candidate !== null && candidate !== undefined && password !== '' && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || !candidate || busy) return;
    if (verification === null) {
      if (!canVerify) return;
      setBusy(true);
      setErrorKey(null);
      try {
        // Only the PUBLIC candidate reaches the chain check — the remembered
        // WIF never enters this component.
        const [result] = await verifyKeysOnChain([
          { accountName: candidate.accountName, role: 'posting', publicKey: candidate.publicKey },
        ]);
        if (!result) throw new VaultError('VAULT_KEY_INVALID', 'verification returned no result');
        setVerification({
          accountName: candidate.accountName,
          role: 'posting',
          publicKey: candidate.publicKey,
          result,
        });
      } catch (error) {
        formError(error);
      } finally {
        setBusy(false);
      }
      return;
    }
    // Confirm path: the manager-level orchestration performs the write, the
    // registry re-read, the authenticated-decrypt verification and — only
    // then — the plaintext deletion. Any throw leaves the plaintext intact.
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await manager.migrateRememberedPostingKey({
        vaultName,
        expectedAccountName: candidate.accountName,
        expectedPublicKey: candidate.publicKey,
        password,
      });
      onMigrated(result.outcome);
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="vault-migrate-form">
      <div className="rounded-md border p-3">
        <p className="text-sm font-medium">{t('migrateWhatHappens')}</p>
        <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-5 text-sm">
          <li>{t('migrateStepVault', { account: candidate?.accountName ?? '' })}</li>
          <li>{t('migrateStepDevice')}</li>
          <li>{t('migrateStepClaim')}</li>
          <li>{t('migrateStepUsername')}</li>
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-migrate-account">{t('migrateAccountLabel')}</Label>
        <Input id="vault-migrate-account" value={candidate?.accountName ?? ''} readOnly disabled />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-migrate-key">{t('migrateKeyLabel')}</Label>
        <div className="text-muted-foreground flex items-center gap-2">
          <code className="font-mono text-xs" title={candidate?.publicKey ?? ''}>
            {candidate ? shortPublicKey(candidate.publicKey) : ''}
          </code>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-migrate-password">{t('migratePasswordLabel')}</Label>
        <Input
          id="vault-migrate-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {verification !== null && <KeyVerdictBox verification={verification} testId="vault-migrate-verification" />}
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
            {verification === null ? t('cancelAction') : t('migrateEditAgain')}
          </Button>
          <Button
            type="submit"
            disabled={verification === null ? !canVerify : busy}
            className={modalFormActionButtonClassName}
            data-testid="vault-migrate-primary"
          >
            {busy
              ? verification === null
                ? t('migrateVerifying')
                : t('migrateMigrating')
              : verification === null
                ? t('migrateVerifyButton')
                : t('migrateConfirmButton')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
