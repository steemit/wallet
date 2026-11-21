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
//
// Each key row is TWO lines: the first keeps the badge + note + icon-only
// actions (edit note / remove, labelled via tooltip + aria-label), the second
// (only when the stored entry carries the outer publicKey field — legacy
// entries without it render no second line at all) shows a TRUNCATED public
// key in monospace (`STM` + first 4 + ellipsis + last 4) with a small
// copy-to-clipboard button right after it; the hover title carries the full
// value, and copying always copies the full key.
// A Steem public key is inherently public, so displaying it while LOCKED is
// free of privacy cost; the private key never appears anywhere.
//
// A6-T5 plaintext migration entry point: while the device holds a VALID
// remembered posting-key pair (browser-storage), the header shows a
// "Migrate remembered key" button that opens MigrateRememberedKeyDialog for
// THIS vault — entering a vault's key manager IS the target-vault selection
// (no in-dialog selector). No remembered key -> no entry point (nothing to
// migrate; an inert explanation row would be pure noise). The button
// disappears after a successful migration (the device no longer remembers a
// key) and re-checks on every view mount.
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { VaultError } from '@/lib/vault/errors';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import { readRememberedPostingKeyCandidate } from '@/lib/vault/migration';
import type { VaultAccountSummary, VaultKeyRole, VaultKeySummary } from '@/lib/vault/types';
import { ImportKeyDialog, type AddKeyOutcome } from './import-key-dialog';
import { MigrateRememberedKeyDialog } from './migrate-remembered-key-dialog';
import { ROLE_LABEL_KEYS, shortPublicKey } from './key-verdict';

const ROLE_ORDER: readonly VaultKeyRole[] = ['owner', 'active', 'posting', 'memo'];

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
  // A6-T5: PUBLIC description of the device-remembered key (null = none).
  // Re-read on every view mount so the entry point follows the device state.
  const [rememberedCandidate, setRememberedCandidate] = useState<
    ReturnType<typeof readRememberedPostingKeyCandidate>
  >(null);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<KeyTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<KeyTarget | null>(null);
  // IV of the key whose public key was just copied — drives the brief
  // check-icon feedback. Public data only; nothing sensitive in this state.
  const [copiedIv, setCopiedIv] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  // Sequence guard (A6-T6): refresh re-runs after every per-key action, so a
  // slow earlier load (e.g. the mount read) could otherwise land after a
  // faster later one and resurrect a stale directory. Unmount bumps the
  // counter too, dropping whatever is still in flight.
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    try {
      const directory = await manager.getAccounts(vaultName);
      if (refreshSeqRef.current !== seq) return;
      setAccounts(directory);
      setListErrorKey(null);
    } catch (error) {
      if (refreshSeqRef.current !== seq) return;
      console.error('Failed to load the vault key directory', error);
      setListErrorKey(vaultErrorKey(error));
    }
  }, [manager, vaultName]);

  useEffect(() => {
    return () => {
      // Unmount invalidates in-flight directory loads (refresh during
      // unmount); the vaultName change path also remounts via the panel.
      refreshSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    // Defer past the effect body (refresh can settle before its first await
    // on early-return paths — the vault-manager panel's established pattern).
    void Promise.resolve().then(refresh);
  }, [refresh]);

  useEffect(() => {
    // Same deferred pattern; the candidate is PUBLIC data only (no WIF ever
    // enters this component — see migrate-remembered-key-dialog.tsx).
    void Promise.resolve().then(() => setRememberedCandidate(readRememberedPostingKeyCandidate()));
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copyPublicKey = useCallback(async (key: VaultKeySummary) => {
    if (!key.publicKey) return;
    try {
      await navigator.clipboard.writeText(key.publicKey);
    } catch {
      // Clipboard unavailable or denied — the truncated key stays visible.
      return;
    }
    setCopiedIv(key.iv);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedIv(null), 2000);
  }, []);

  const roleLabel = (role: VaultKeyRole): string => t(ROLE_LABEL_KEYS[role]);

  const totalKeys =
    accounts?.reduce((count, account) => count + account.keys.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="vault-key-manager">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('keysTitle', { name: vaultName })}</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setAddKeyOpen(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            {t('keysAddKey')}
          </Button>
          {rememberedCandidate !== null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMigrateOpen(true)}
              data-testid="vault-migrate-remembered-button"
            >
              <KeyRound data-icon="inline-start" aria-hidden />
              {t('migrateRememberedButton')}
            </Button>
          )}
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
                  className="bg-muted/30 flex flex-col gap-0.5 rounded-md border px-2 py-1.5"
                  data-testid="vault-key-row"
                  data-key-iv={key.iv}
                >
                  <div className="flex items-center justify-between gap-2 max-sm:flex-wrap">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                        {roleLabel(key.role)}
                      </span>
                      <span
                        className="text-muted-foreground min-w-0 truncate text-xs"
                        title={key.note === '' ? undefined : key.note}
                      >
                        {key.note === '' ? t('keysNoNote') : key.note}
                      </span>
                    </span>
                    <span className="ml-auto flex shrink-0 gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('keysEditNote')}
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
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('keysEditNote')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="text-destructive hover:text-destructive"
                            aria-label={t('keysRemoveKey')}
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
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('keysRemoveKey')}</TooltipContent>
                      </Tooltip>
                    </span>
                  </div>
                  {key.publicKey !== null && (
                    <div
                      className="flex flex-wrap items-center gap-x-1 gap-y-1 pl-1"
                      data-testid="vault-key-public-key"
                    >
                      <code
                        className="text-muted-foreground min-w-0 font-mono text-xs"
                        title={key.publicKey}
                      >
                        {shortPublicKey(key.publicKey)}
                      </code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={copiedIv === key.iv ? t('keysPublicKeyCopied') : t('keysPublicKeyCopy')}
                        title={copiedIv === key.iv ? t('keysPublicKeyCopied') : t('keysPublicKeyCopy')}
                        onClick={() => void copyPublicKey(key)}
                      >
                        {copiedIv === key.iv ? <Check aria-hidden /> : <Copy aria-hidden />}
                      </Button>
                    </div>
                  )}
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

      <MigrateRememberedKeyDialog
        open={migrateOpen}
        onOpenChange={setMigrateOpen}
        vaultName={vaultName}
        manager={manager}
        onMigrated={(outcome) => {
          setActionInfoKey(outcome === 'migrated' ? 'migrateSuccess' : 'migrateAlreadyPresent');
          setActionErrorKey(null);
          // The device no longer remembers a key — the entry point disappears.
          setRememberedCandidate(readRememberedPostingKeyCandidate());
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
