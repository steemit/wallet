'use client';

// Vault per-key signing dialog (A6-T2) — the password half of the vault
// session signing path. A `sessionKind: 'vault'` session holds NO key
// material (invariant 21), so signing resolves ONE encrypted key per
// operation: the user picks it from the LOCKED-READABLE public directory
// (auto-selected when there is exactly one candidate) and types the vault
// password, which travels straight into `vaultSigner.signOperations` for
// that single operation (invariant 5 — no unlock, no global session).
//
// Candidate enumeration = the public directory entries stored under roles
// AT-OR-ABOVE the request's role floor (owner > active > posting), mirroring
// the signer's authority-verification floor. Each candidate carries its own
// STORAGE role — the request sends exactly that role with the key's IV,
// because `selectEncryptedKey` reads `keys[role]` (the signer binds the
// encrypted record to the named role array).
//
// The dialog NEVER fetches `/api/query/accounts` itself — the on-chain
// authority pre-check (invariant 19) belongs to the vault signer alone.
//
// Error handling (the A5 UI rule): every VaultError maps to
// `vault.errors.<CODE>` i18n keys — raw English messages never render.
// `VAULT_PASSWORD_INVALID` keeps the dialog open for an in-place retry
// (the typed password is cleared first); every other error also stays
// in-dialog (retry or cancel) and NEVER resolves the caller's promise as an
// error — the only outcomes handed back are `signed` and `cancelled`.
//
// PASSWORD DISCIPLINE (mirrors import-key-dialog): the password lives only
// in this form's transient state and the single signing call — never Redux,
// logs, analytics or persisted state. It is cleared on success, on cancel,
// on every failed attempt and on unmount; the form mounts only while the
// dialog is open (Radix unmounts closed content).
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { KeySquare, Loader2, RotateCcw } from 'lucide-react';

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
import { sameSteemAccount } from '@/lib/steem/username';
import { VAULT_WORK_MODE_OPEN_EVENT } from '@/components/vault/work-mode-events';
import { useVaultRuntime } from '@/components/vault/vault-manager';
import { shortPublicKey } from '@/components/vault/vault-key-manager';
import type { Operation } from '@/lib/steem/types';
import type { SignResult, SigningRole, VaultAccountSummary } from '@/lib/vault/types';

/** Privilege rank of a signing role (posting < active < owner). */
const SIGNING_ROLE_RANK: Record<SigningRole, number> = {
  posting: 0,
  active: 1,
  owner: 2,
};

/** Roles at-or-above `floor`, lowest privilege first (the key-selection rule). */
export function signingRolesAtOrAbove(floor: SigningRole): SigningRole[] {
  return (['posting', 'active', 'owner'] as const).filter(
    (role) => SIGNING_ROLE_RANK[role] >= SIGNING_ROLE_RANK[floor],
  );
}

/** A signing request as the dialog and the hook exchange it. */
export interface SessionSignRequest {
  /** Frozen operation tuples — the dialog never inspects or rebuilds them. */
  operations: Operation[];
  /** Account the operations are signed for (normalized). */
  accountName: string;
  /** Minimum storage role whose keys are offered (the signer's floor). */
  role: SigningRole;
}

/** One selectable encrypted key from the locked-readable public directory. */
export interface VaultSigningCandidate {
  role: SigningRole;
  iv: string;
  note: string;
  publicKey: string | null;
}

/** Terminal outcomes the dialog reports to its host (errors stay inside). */
export type VaultSigningDialogOutcome =
  | { status: 'signed'; result: SignResult }
  | { status: 'cancelled' };

export interface VaultSigningDialogProps {
  /** The pending request; the dialog is mounted only while one exists. */
  request: SessionSignRequest;
  /** Resolves the host's sign() promise. Called exactly once. */
  onOutcome: (outcome: VaultSigningDialogOutcome) => void;
}

/** Map any thrown value to a `vault.errors.*` i18n key (the A5 UI rule). */
function vaultErrorKey(error: unknown): string {
  if (error instanceof VaultError) {
    return `errors.${error.code}`;
  }
  console.error('Unexpected vault signing error', error);
  return 'errors.unexpected';
}

/**
 * The per-operation password dialog for vault identity sessions. Rendered by
 * `useSessionSigning`'s host surfaces while a vault signing request is
 * pending; never rendered for privateKey sessions.
 */
export function VaultSigningDialog({ request, onOutcome }: VaultSigningDialogProps) {
  const t = useTranslations('vault');
  const runtime = useVaultRuntime();

  // Radix close requests (X / overlay / Esc) are the cancel path; the inner
  // form scrubs its password when it unmounts.
  return (
    <Dialog open onOpenChange={(next) => !next && onOutcome({ status: 'cancelled' })}>
      <DialogContent className="z-[60] sm:max-w-md" data-testid="vault-signing-dialog">
        <DialogHeader>
          <DialogTitle>{t('signDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('signDialogDescription', {
              account: request.accountName,
              role: t(`keysRole${request.role.charAt(0).toUpperCase()}${request.role.slice(1)}`),
            })}
          </DialogDescription>
        </DialogHeader>
        <VaultSigningForm request={request} onOutcome={onOutcome} runtime={runtime} />
      </DialogContent>
    </Dialog>
  );
}

/** A settled directory load (`generation` keys explicit retries). */
interface DirectoryState {
  vaultResolved: true;
  generation: number;
  accounts: VaultAccountSummary[] | null;
  errorKey: string | null;
}

function VaultSigningForm({
  request,
  onOutcome,
  runtime,
}: {
  request: SessionSignRequest;
  onOutcome: (outcome: VaultSigningDialogOutcome) => void;
  runtime: ReturnType<typeof useVaultRuntime>;
}) {
  const t = useTranslations('vault');
  const tCommon = useTranslations('common');
  const manager = runtime.state === 'ready' ? runtime.manager : null;
  const vaultSigner = runtime.state === 'ready' ? runtime.vaultSigner : null;

  const [directory, setDirectory] = useState<DirectoryState | null>(null);
  const [generation, setGeneration] = useState(0);
  const [choiceIv, setChoiceIv] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** Wrong-password attempts show the retry hint under the mapped error. */
  const [passwordRejected, setPasswordRejected] = useState(false);
  const resolvedRef = useRef(false);
  const directorySeqRef = useRef(0);

  // Unmount (dialog closed / cancelled / host unmounted) scrubs the password
  // — belt and braces on top of React discarding unmounted state; documents
  // that no password may survive the dialog.
  useEffect(() => {
    return () => {
      setPassword('');
    };
  }, []);

  // Load the candidate directory from the LOCKED-READABLE public data. The
  // no-argument getAccounts() resolves session vault -> ACTIVE vault — the
  // SAME resolution the vault signer's getRecordSnapshot() applies, so the
  // listed IVs always belong to the vault that will actually sign.
  useEffect(() => {
    if (!manager) return;
    const seq = directorySeqRef.current + 1;
    directorySeqRef.current = seq;
    void Promise.resolve()
      .then(() => manager.getAccounts())
      .then(
        (accounts) => {
          if (directorySeqRef.current !== seq) return;
          setDirectory({ vaultResolved: true, generation, accounts, errorKey: null });
        },
        (error: unknown) => {
          if (directorySeqRef.current !== seq) return;
          console.error('Failed to load the vault key directory for signing', error);
          setDirectory({
            vaultResolved: true,
            generation,
            accounts: null,
            errorKey: vaultErrorKey(error),
          });
        },
      );
  }, [manager, generation]);

  const candidates = (() => {
    if (directory === null || directory.accounts === null) return null;
    const floor = SIGNING_ROLE_RANK[request.role];
    const account = directory.accounts.find((entry) =>
      sameSteemAccount(entry.accountName, request.accountName),
    );
    if (!account) return [];
    return account.keys.flatMap((key) =>
      key.role !== 'memo' && SIGNING_ROLE_RANK[key.role] >= floor
        ? [
            {
              role: key.role,
              iv: key.iv,
              note: key.note,
              publicKey: key.publicKey,
            } satisfies VaultSigningCandidate,
          ]
        : [],
    );
  })();

  // Exactly one candidate selects itself; several require an explicit choice
  // (no silent default — the user must see WHICH key signs).
  const selected =
    candidates === null
      ? null
      : candidates.length === 1
        ? (candidates[0] ?? null)
        : (candidates.find((candidate) => candidate.iv === choiceIv) ?? null);

  const scrubPassword = () => setPassword('');

  const finish = (outcome: VaultSigningDialogOutcome) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    scrubPassword();
    onOutcome(outcome);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !vaultSigner || !manager || selected === null || password === '') return;
    setBusy(true);
    setErrorKey(null);
    setPasswordRejected(false);
    try {
      // The one and only decryption surface of this flow: the signer derives
      // the KEK from this password, decrypts ONLY the selected key, verifies
      // the on-chain authority and scrubs everything before returning.
      const result = await vaultSigner.signOperations({
        accountName: request.accountName,
        role: selected.role,
        keyIv: selected.iv,
        vaultPassword: password,
        operations: request.operations,
      });
      finish({ status: 'signed', result });
    } catch (error) {
      const key = vaultErrorKey(error);
      setErrorKey(key);
      setPasswordRejected(key === 'errors.VAULT_PASSWORD_INVALID');
      // A failed attempt never keeps the typed password around; the dialog
      // stays open so the user can retry or cancel.
      scrubPassword();
      setBusy(false);
    }
  };

  const roleLabel = (role: SigningRole) =>
    t(`keysRole${role.charAt(0).toUpperCase()}${role.slice(1)}`);

  const renderBody = () => {
    if (runtime.state === 'unavailable') {
      return (
        <DirectoryErrorBox
          messageKey={`errors.${runtime.code}`}
          onRetry={runtime.retry}
          retryLabel={t('retry')}
          onOpenWorkMode={() =>
            window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT))
          }
          openWorkModeLabel={t('openVaultManagement')}
          onCancel={() => finish({ status: 'cancelled' })}
          cancelLabel={tCommon('cancel')}
        />
      );
    }
    if (!manager || directory === null) {
      return <PendingRow label={t('signDialogLoading')} />;
    }
    if (directory.errorKey !== null) {
      return (
        <DirectoryErrorBox
          messageKey={directory.errorKey}
          onRetry={() => setGeneration((value) => value + 1)}
          retryLabel={t('retry')}
          onOpenWorkMode={() =>
            window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT))
          }
          openWorkModeLabel={t('openVaultManagement')}
          onCancel={() => finish({ status: 'cancelled' })}
          cancelLabel={tCommon('cancel')}
        />
      );
    }
    if (candidates === null) {
      return <PendingRow label={t('signDialogLoading')} />;
    }
    if (candidates.length === 0) {
      return (
        <div className="flex flex-col gap-3" data-testid="vault-signing-no-keys">
          <div className="bg-muted/40 rounded-lg border border-dashed p-4" role="alert">
            <p className="text-sm font-medium">
              {t('signDialogNoKeys', { account: request.accountName })}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('signDialogNoKeysHint', { role: roleLabel(request.role) })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              finish({ status: 'cancelled' });
              window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT));
            }}
          >
            <KeySquare data-icon="inline-start" aria-hidden />
            {t('openVaultManagement')}
          </Button>
        </div>
      );
    }
    return (
      <form onSubmit={submit} className="flex flex-col gap-3" data-testid="vault-signing-form">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('signDialogKeyLabel')}</span>
          {candidates.length === 1 && selected !== null ? (
            <CandidateLine candidate={selected} roleLabel={roleLabel(selected.role)} />
          ) : (
            <fieldset className="flex flex-col gap-1.5" data-testid="vault-signing-key-options">
              {candidates.map((candidate) => (
                <label
                  key={candidate.iv}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm"
                >
                  <input
                    type="radio"
                    name="vault-signing-key"
                    className="mt-1"
                    checked={choiceIv === candidate.iv}
                    onChange={() => setChoiceIv(candidate.iv)}
                    disabled={busy}
                    data-testid={`vault-signing-key-${candidate.iv}`}
                  />
                  <CandidateLine
                    candidate={candidate}
                    roleLabel={roleLabel(candidate.role)}
                  />
                </label>
              ))}
            </fieldset>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vault-signing-password">{t('signDialogPasswordLabel')}</Label>
          <Input
            id="vault-signing-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </div>
        {errorKey && (
          <div className="border-destructive/20 bg-destructive/10 rounded-md border p-3" role="alert">
            <p className="text-destructive text-sm font-medium">{t(errorKey)}</p>
            {passwordRejected && (
              <p className="text-destructive mt-1 text-sm">
                {t('signDialogRetryHint')}
              </p>
            )}
          </div>
        )}
        <p className="text-muted-foreground text-xs">{t('signDialogPasswordHint')}</p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => finish({ status: 'cancelled' })}
            disabled={busy}
            className={modalFormActionButtonClassName}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={busy || selected === null || password === ''}
            className={modalFormActionButtonClassName}
            data-testid="vault-signing-submit"
          >
            {busy ? t('signDialogSigning') : t('signDialogSubmit')}
          </Button>
        </DialogFooter>
      </form>
    );
  };

  return <div className="flex flex-col gap-3">{renderBody()}</div>;
}

/** Note + storage role (+ truncated public key when the entry carries one). */
function CandidateLine({
  candidate,
  roleLabel,
}: {
  candidate: VaultSigningCandidate;
  roleLabel: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-medium">
        {candidate.note.trim() !== '' ? candidate.note : roleLabel}
      </span>
      <span className="text-muted-foreground text-xs">
        {roleLabel}
        {candidate.publicKey !== null && (
          <>
            {' · '}
            <code title={candidate.publicKey} className="font-mono">
              {shortPublicKey(candidate.publicKey)}
            </code>
          </>
        )}
      </span>
    </span>
  );
}

function PendingRow({ label }: { label: string }) {
  return (
    <p
      className="text-muted-foreground flex items-center gap-2 px-1 py-2 text-sm"
      data-testid="vault-signing-loading"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </p>
  );
}

function DirectoryErrorBox({
  messageKey,
  onRetry,
  retryLabel,
  onOpenWorkMode,
  openWorkModeLabel,
  onCancel,
  cancelLabel,
}: {
  messageKey: string;
  onRetry: () => void;
  retryLabel: string;
  onOpenWorkMode: () => void;
  openWorkModeLabel: string;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const t = useTranslations('vault');
  return (
    <div className="flex flex-col gap-3" data-testid="vault-signing-error">
      <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4" role="alert">
        <p className="text-destructive text-sm font-medium">{t(messageKey)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" aria-hidden />
          {retryLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenWorkMode}>
          <KeySquare data-icon="inline-start" aria-hidden />
          {openWorkModeLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
