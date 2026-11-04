'use client';

// Unlock dialog (A5) — asks for the vault's EXISTING password and unlocks it
// in the manager's session service (this tab). Unlock deliberately runs no
// password-strength policy: the vault must keep accepting the password it was
// created with (A1.1 rule). One PBKDF2 derivation (~1s) runs per attempt —
// the button shows a pending state and is disabled while it runs.
//
// The form body is a separate component mounted inside DialogContent: Radix
// unmounts closed dialog content, so every open starts from a fresh,
// cleared form without reset effects.
//
// The password exists only in this component's state and the unlock call; it
// never reaches Redux, logs or the network.
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { modalFormActionButtonClassName } from '@/components/ui/modal-form-actions';
import { VaultError } from '@/lib/vault/errors';
import type { VaultManagerExtended } from '@/lib/vault/manager';

export interface UnlockVaultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vault to unlock (display name). */
  vaultName: string;
  manager: VaultManagerExtended | null;
  /** Called after a successful unlock (the host refreshes its list). */
  onUnlocked?: () => void;
}

export function UnlockVaultDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onUnlocked,
}: UnlockVaultDialogProps) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('unlockTitle')}</DialogTitle>
          <DialogDescription>{t('unlockDescription', { name: vaultName })}</DialogDescription>
        </DialogHeader>
        <UnlockVaultForm
          vaultName={vaultName}
          manager={manager}
          onUnlocked={() => {
            onUnlocked?.();
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function UnlockVaultForm({
  vaultName,
  manager,
  onUnlocked,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const tCommon = useTranslations('common');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || busy || password === '') return;
    setBusy(true);
    setErrorKey(null);
    try {
      await manager.unlockVault(vaultName, password);
      onUnlocked();
    } catch (error) {
      if (error instanceof VaultError) {
        setErrorKey(`errors.${error.code}`);
      } else {
        console.error('Failed to unlock the vault', error);
        setErrorKey('errors.unexpected');
      }
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-unlock-password">{t('unlockPasswordLabel')}</Label>
        <Input
          id="vault-unlock-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
      {errorKey && (
        <p className="text-destructive text-sm font-medium" role="alert">
          {t(errorKey)}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className={modalFormActionButtonClassName}
        >
          {tCommon('cancel')}
        </Button>
        <Button
          type="submit"
          disabled={busy || password === ''}
          className={modalFormActionButtonClassName}
        >
          {busy ? t('unlocking') : t('unlockButton')}
        </Button>
      </DialogFooter>
    </form>
  );
}
