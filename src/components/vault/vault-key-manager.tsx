'use client';

// Vault key manager (R2) — locked-state browsing + per-key operations.
//
// BROWSING IS LOCK-STATE: the whole directory (account names, per-role key
// counts, outer notes) comes from `manager.getAccounts` — the R1 public
// directory that resolves the session vault → active vault with NO password.
// No unlock is ever requested to view this panel; that is by design (see
// docs/AI-driver/09-vault.md invariant 2), so do not "harden" it back.
//
// Per-key operations ride the R1 service primitives through the manager:
//   - update note (public metadata edit; ciphertext untouched);
//   - remove, located by account + role + IV (the IV is the per-key unique
//     identifier) behind an explicit second confirmation dialog — no vault
//     password is involved (removal only deletes ciphertext);
//   - add key opens ImportKeyDialog (see its header for the WIF discipline).
//
// UI conventions: secondary dialogs are z-[60]; button pairs sit in a
// two-column grid; VaultErrors map to `vault.errors.<CODE>` i18n keys — raw
// English messages never render.
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

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
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultAccountSummary, VaultKeyRole } from '@/lib/vault/types';
import { ImportKeyDialog, type AddKeyOutcome } from './import-key-dialog';

const ROLE_ORDER: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

const ROLE_LABEL_KEYS: Record<VaultKeyRole, string> = {
  owner: 'keysRoleOwner',
  active: 'keysRoleActive',
  posting: 'keysRolePosting',
  memo: 'keysRoleMemo',
};

/** A key the note/remove dialogs currently target (IV = unique pointer). */
interface KeyTarget {
  accountName: string;
  role: VaultKeyRole;
  iv: string;
  note: string;
}

function vaultErrorKey(error: unknown): string {
  if (error instanceof VaultError) {
    return `errors.${error.code}`;
  }
  console.error('Unexpected vault key manager error', error);
  return 'errors.unexpected';
}

export interface VaultKeyManagerProps {
  /** Vault whose directory is displayed (display name). */
  vaultName: string;
  manager: VaultManagerExtended;
  /** Returns to the vault list view. */
  onBack: () => void;
}

export function VaultKeyManager({ vaultName, manager, onBack }: VaultKeyManagerProps) {
  const t = useTranslations('vault');
  const [accounts, setAccounts] = useState<VaultAccountSummary[] | null>(null);
  const [listErrorKey, setListErrorKey] = useState<string | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [actionInfoKey, setActionInfoKey] = useState<string | null>(null);
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<KeyTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<KeyTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      const directory = await manager.getAccounts(vaultName);
      setAccounts(directory);
      setListErrorKey(null);
    } catch (error) {
      console.error('Failed to load the vault key directory', error);
      setListErrorKey(vaultErrorKey(error));
    }
  }, [manager, vaultName]);

  useEffect(() => {
    // Defer past the effect body (refresh can settle before its first await
    // on early-return paths — the vault-manager panel's established pattern).
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const roleLabel = (role: VaultKeyRole): string => t(ROLE_LABEL_KEYS[role]);

  const totalKeys =
    accounts?.reduce((count, account) => count + account.keys.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="vault-key-manager">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('keysTitle', { name: vaultName })}</h3>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => setAddKeyOpen(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            {t('keysAddKey')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            {t('backToList')}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{t('keysDescription')}</p>

      {actionInfoKey && (
        <div className="bg-muted/40 rounded-md border p-3" role="status">
          <p className="text-sm">{t(actionInfoKey)}</p>
        </div>
      )}
      {actionErrorKey && (
        <div className="border-destructive/20 bg-destructive/10 rounded-md border p-3" role="alert">
          <p className="text-destructive text-sm font-medium">{t(actionErrorKey)}</p>
        </div>
      )}

      {listErrorKey && (
        <div className="flex flex-col gap-2">
          <div className="border-destructive/20 bg-destructive/10 rounded-md border p-3" role="alert">
            <p className="text-destructive text-sm font-medium">{t(listErrorKey)}</p>
          </div>
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
              <RotateCcw data-icon="inline-start" aria-hidden />
              {t('retry')}
            </Button>
          </div>
        </div>
      )}

      {accounts === null && !listErrorKey && (
        <p className="text-muted-foreground flex items-center gap-2 px-1 py-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('keysLoading')}
        </p>
      )}

      {accounts !== null && totalKeys === 0 && (
        <div className="bg-muted/40 rounded-lg border border-dashed p-4 text-center">
          <p className="text-muted-foreground text-sm">{t('keysEmpty')}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {accounts?.map((account) => (
          <li
            key={account.accountName}
            className="rounded-lg border p-3"
            data-testid="vault-key-account"
            data-account={account.accountName}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{account.accountName}</span>
              <span className="text-muted-foreground text-xs">
                {ROLE_ORDER.map(
                  (role) =>
                    `${roleLabel(role)} ${
                      account.keys.filter((key) => key.role === role).length
                    }`,
                ).join(' · ')}
              </span>
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {account.keys.map((key) => (
                <li
                  key={key.iv}
                  className="bg-muted/30 flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
                  data-testid="vault-key-row"
                  data-key-iv={key.iv}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                      {roleLabel(key.role)}
                    </span>
                    <span
                      className="text-muted-foreground truncate text-xs"
                      title={key.note === '' ? undefined : key.note}
                    >
                      {key.note === '' ? t('keysNoNote') : key.note}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setNoteTarget({
                          accountName: account.accountName,
                          role: key.role,
                          iv: key.iv,
                          note: key.note,
                        })
                      }
                    >
                      <Pencil aria-hidden />
                      {t('keysEditNote')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        setRemoveTarget({
                          accountName: account.accountName,
                          role: key.role,
                          iv: key.iv,
                          note: key.note,
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                      {t('keysRemoveKey')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <ImportKeyDialog
        open={addKeyOpen}
        onOpenChange={setAddKeyOpen}
        vaultName={vaultName}
        manager={manager}
        onAdded={(outcome: AddKeyOutcome) => {
          setActionInfoKey(outcome);
          setActionErrorKey(null);
          void refresh();
        }}
      />

      <EditKeyNoteDialog
        target={noteTarget}
        vaultName={vaultName}
        manager={manager}
        onSaved={() => {
          setActionInfoKey('keysNoteSaved');
          setActionErrorKey(null);
          void refresh();
        }}
        onClose={() => setNoteTarget(null)}
      />

      <RemoveKeyDialog
        target={removeTarget}
        vaultName={vaultName}
        manager={manager}
        onRemoved={() => {
          setActionInfoKey('keysRemoved');
          setActionErrorKey(null);
          void refresh();
        }}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit note dialog
// ---------------------------------------------------------------------------

function EditKeyNoteDialog({
  target,
  vaultName,
  manager,
  onSaved,
  onClose,
}: {
  target: KeyTarget | null;
  vaultName: string;
  manager: VaultManagerExtended;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('vault');
  const roleLabel = target !== null ? t(ROLE_LABEL_KEYS[target.role]) : '';
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('keysNoteTitle')}</DialogTitle>
          <DialogDescription>
            {t('keysNoteDescription', {
              account: target?.accountName ?? '',
              role: roleLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        {target !== null && (
          <EditKeyNoteForm
            target={target}
            vaultName={vaultName}
            manager={manager}
            onSaved={() => {
              onSaved();
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditKeyNoteForm({
  target,
  vaultName,
  manager,
  onSaved,
  onCancel,
}: {
  target: KeyTarget;
  vaultName: string;
  manager: VaultManagerExtended;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [note, setNote] = useState(target.note);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await manager.updateKeyNote(
        {
          vaultName,
          accountName: target.accountName,
          role: target.role,
          keyIv: target.iv,
        },
        note,
      );
      onSaved();
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t('addKeyNoteWarning')}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-key-note-input">{t('keysNoteLabel')}</Label>
        <Input
          id="vault-key-note-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={256}
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
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className={modalFormActionButtonClassName}
          >
            {t('cancelAction')}
          </Button>
          <Button type="submit" disabled={busy} className={modalFormActionButtonClassName}>
            {busy ? t('keysNoteSaving') : t('keysNoteSave')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Remove key confirmation dialog
// ---------------------------------------------------------------------------

function RemoveKeyDialog({
  target,
  vaultName,
  manager,
  onRemoved,
  onClose,
}: {
  target: KeyTarget | null;
  vaultName: string;
  manager: VaultManagerExtended;
  onRemoved: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('vault');
  const roleLabel = target !== null ? t(ROLE_LABEL_KEYS[target.role]) : '';
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="z-[60] sm:max-w-md" data-testid="vault-remove-key-dialog">
        <DialogHeader>
          <DialogTitle>{t('keysRemoveTitle')}</DialogTitle>
          <DialogDescription>
            {t('keysRemoveDescription', {
              account: target?.accountName ?? '',
              role: roleLabel,
            })}
          </DialogDescription>
        </DialogHeader>
        {target !== null && (
          <RemoveKeyForm
            target={target}
            vaultName={vaultName}
            manager={manager}
            onRemoved={() => {
              onRemoved();
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveKeyForm({
  target,
  vaultName,
  manager,
  onRemoved,
  onCancel,
}: {
  target: KeyTarget;
  vaultName: string;
  manager: VaultManagerExtended;
  onRemoved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await manager.removeKey({
        vaultName,
        accountName: target.accountName,
        role: target.role,
        keyIv: target.iv,
      });
      onRemoved();
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p className="text-destructive text-sm font-medium">{t('keysRemoveWarning')}</p>
      </div>
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
            onClick={onCancel}
            disabled={busy}
            className={modalFormActionButtonClassName}
          >
            {t('cancelAction')}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={busy}
            className={modalFormActionButtonClassName}
          >
            {busy ? t('keysRemoving') : t('keysRemoveConfirm')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
