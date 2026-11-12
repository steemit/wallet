'use client';

// Vault identity selection (R3) — the Vault Mode "login": pick a vault and an
// account from the LOCKED-READABLE public directory and record the selection
// as the session identity. NO unlock, NO decryption, NO network
// authentication: the auth slice's `setVaultIdentity` stores only the
// username with `sessionKind: 'vault'` and every key field null (docs/
// AI-driver/09-vault.md, R3). Signing later resolves one encrypted key per
// operation with its own password (A6 wiring).
//
// Data sources (public by design — invariant 2):
//   - vault list: `manager.listVaults()` (display names + active flag);
//   - account list: `manager.getAccounts(vaultName)` — the outer `accounts`
//     of the selected vault; only account names are rendered (no IVs, no
//     ciphertext, no notes in this form). Accounts holding NO key at all
//     (storable via an imported backup — the envelope allows them) are not
//     offered: such an identity could never sign; a vault with only keyless
//     accounts reads as the empty-vault state.
//
// Selection semantics (handoff §5 step 4):
//   - the ACTIVE vault (settings.activeVaultName) is selected by default,
//     otherwise the first vault;
//   - switching the vault immediately clears the account selection, and the
//     account-directory load is sequence-guarded so a SLOW response for a
//     previously selected vault can never overwrite the directory of the
//     currently selected one;
//   - empty states: no vault at all -> create/import entry (opens the Work
//     Mode modal); vault without accounts -> "add a key first" (also Work
//     Mode); storage/runtime errors -> the mapped `vault.errors.*` message
//     with a Retry button. Never a fallback to the PrivateKey form.
//   - directory changes: the vault list and the selected directory are
//     re-read when the Work Mode modal closes (all management happens there —
//     VAULT_WORK_MODE_CLOSED_EVENT) and when the tab becomes visible again
//     (changes made in another tab). Refreshes are stale-while-revalidate: the
//     current selects stay usable, and explicit choices survive while the
//     chosen vault / account still exist.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDispatch } from 'react-redux';
import { KeySquare, Loader2, RotateCcw } from 'lucide-react';

import { AppDispatch } from '@/lib/store';
import { setVaultIdentity } from '@/lib/store/slices/auth';
import { useVaultRuntime } from '@/components/vault/vault-manager';
import {
  VAULT_WORK_MODE_CLOSED_EVENT,
  VAULT_WORK_MODE_OPEN_EVENT,
} from '@/components/vault/work-mode-events';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { VaultError } from '@/lib/vault/errors';
import { normalizeSteemUsername } from '@/lib/steem/username';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';
import type { VaultAccountSummary, VaultSummary } from '@/lib/vault/types';

export interface VaultLoginFormProps {
  /**
   * Dialog / in-page modal: compact layout and `onLoginSuccess` instead of
   * redirect (mirrors the private-key form's embedded mode).
   */
  embedded?: boolean;
  onLoginSuccess?: (() => void) | undefined;
}

/** Map any thrown value to a `vault.errors.*` i18n key (the A5 UI rule). */
function vaultErrorKey(error: unknown): string {
  if (error instanceof VaultError) {
    return `errors.${error.code}`;
  }
  console.error('Unexpected vault login error', error);
  return 'errors.unexpected';
}

function PendingRow({ label }: { label: string }) {
  return (
    <p
      className="text-muted-foreground flex items-center gap-2 px-1 py-2 text-sm"
      data-testid="vault-login-loading"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </p>
  );
}

/**
 * Inline error box + retry, in place of the selects (never a PrivateKey
 * fallback). `onOpenWorkMode` adds the management escape hatch: the Work Mode
 * modal is where the user can clear records this version cannot read (e.g. a
 * vault written by an older envelope format), so a directory load failure is
 * never a dead end.
 */
function ErrorRetryBox({
  messageKey,
  onRetry,
  onOpenWorkMode,
}: {
  messageKey: string;
  onRetry: () => void;
  onOpenWorkMode: () => void;
}) {
  const t = useTranslations('vault');
  return (
    <div className="flex flex-col gap-3" data-testid="vault-login-error">
      <div className="border-destructive/20 bg-destructive/10 rounded-md border p-4" role="alert">
        <p className="text-destructive text-sm font-medium">{t(messageKey)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" aria-hidden />
          {t('retry')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenWorkMode}>
          <KeySquare data-icon="inline-start" aria-hidden />
          {t('openVaultManagement')}
        </Button>
      </div>
    </div>
  );
}

/**
 * One settled account-directory load. Keyed by the vault it belongs to and
 * the retry generation that produced it: render only trusts a result whose
 * key matches the CURRENT selection — anything else reads as "loading".
 */
interface DirectoryResult {
  vaultName: string;
  generation: number;
  accounts: VaultAccountSummary[] | null;
  errorKey: string | null;
}

export function VaultLoginForm({ embedded = false, onLoginSuccess }: VaultLoginFormProps = {}) {
  const t = useTranslations('auth');
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const runtime = useVaultRuntime();
  const manager = runtime.state === 'ready' ? runtime.manager : null;

  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [listErrorKey, setListErrorKey] = useState<string | null>(null);
  // The user's EXPLICIT choices. The effective selections are DERIVED during
  // render (below), so defaults and "clear on vault switch" need no effects.
  const [vaultChoice, setVaultChoice] = useState<string | null>(null);
  const [accountChoice, setAccountChoice] = useState<{
    vaultName: string;
    accountName: string;
  } | null>(null);
  const [directory, setDirectory] = useState<DirectoryResult | null>(null);
  // `generation` = explicit Retry after a directory error: part of the result
  // key, so the stale error reads as "loading" until the retry lands.
  // `refreshNonce` = background refresh: NOT part of the key, so the current
  // directory stays visible until the re-read lands (no loading flash).
  const [generation, setGeneration] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Sequence guard for account-directory loads: only the response of the
  // LATEST request may land — a slow response for a previously selected vault
  // is dropped instead of overwriting the new selection's directory.
  const directorySeqRef = useRef(0);

  const refreshVaults = useCallback(async () => {
    if (!manager) return;
    try {
      const list = await manager.listVaults();
      setVaults(list);
      setListErrorKey(null);
    } catch (error) {
      console.error('Failed to list vaults for identity selection', error);
      setVaults(null);
      setListErrorKey(vaultErrorKey(error));
    }
  }, [manager]);

  useEffect(() => {
    if (!manager) return;
    // Defer past the effect body (refreshVaults can settle before its first
    // await on the null-manager early-return path — the panel pattern).
    void Promise.resolve().then(refreshVaults);
  }, [manager, refreshVaults]);

  // Re-read the public directory after vault management (Work Mode modal
  // closed) and when the tab becomes visible again (other-tab changes).
  useEffect(() => {
    if (!manager) return;
    const refresh = () => {
      void refreshVaults();
      setRefreshNonce((value) => value + 1);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener(VAULT_WORK_MODE_CLOSED_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener(VAULT_WORK_MODE_CLOSED_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [manager, refreshVaults]);

  // Effective vault: the explicit choice while it still exists, otherwise the
  // ACTIVE vault (settings.activeVaultName), otherwise the first one.
  let selectedVault: string | null = null;
  if (vaults !== null && vaults.length > 0) {
    selectedVault =
      vaultChoice !== null && vaults.some((vault) => vault.vaultName === vaultChoice)
        ? vaultChoice
        : ((vaults.find((vault) => vault.active) ?? vaults[0])?.vaultName ?? null);
  }

  // Load the selected vault's public account directory. State is written only
  // from the async callbacks, and only by the latest request.
  useEffect(() => {
    if (selectedVault === null || !manager) return;
    const seq = directorySeqRef.current + 1;
    directorySeqRef.current = seq;
    const vaultName = selectedVault;
    manager.getAccounts(vaultName).then(
      (accounts) => {
        if (directorySeqRef.current !== seq) return;
        setDirectory({ vaultName, generation, accounts, errorKey: null });
      },
      (error: unknown) => {
        if (directorySeqRef.current !== seq) return;
        console.error('Failed to load the vault account directory', error);
        setDirectory({ vaultName, generation, accounts: null, errorKey: vaultErrorKey(error) });
      },
    );
    // refreshNonce only re-triggers the read (see its declaration).
  }, [selectedVault, manager, generation, refreshNonce]);

  const directoryCurrent =
    directory !== null &&
    directory.vaultName === selectedVault &&
    directory.generation === generation;
  // Selectable identities: accounts that hold at least one stored key.
  const accounts = directoryCurrent
    ? (directory.accounts?.filter((account) => account.keys.length > 0) ?? null)
    : null;
  const accountsErrorKey = directoryCurrent ? directory.errorKey : null;

  // Effective account: only a choice made for THIS vault that still exists in
  // its directory — a vault switch therefore reads as "nothing selected".
  const selectedAccount =
    accountChoice !== null &&
    accountChoice.vaultName === selectedVault &&
    accounts?.some((account) => account.accountName === accountChoice.accountName)
      ? accountChoice.accountName
      : '';

  const openWorkMode = () => {
    window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedAccount === '') return;
    const username = normalizeSteemUsername(selectedAccount);
    // The whole "login": record the identity locally. No unlock, no
    // challenge, no login request — the vault session is client-side only.
    dispatch(setVaultIdentity({ username }));
    if (embedded) {
      onLoginSuccess?.();
    } else {
      router.push(transfersPathForUsername(username));
    }
  };

  const selectClassName =
    'border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm';

  /**
   * The account area under the (always visible) vault select: loading,
   * directory error + retry, empty vault, or the account select. Keeping the
   * vault select mounted through every one of these states is deliberate —
   * the user can switch vaults while a directory load is still in flight
   * (the sequence guard drops the stale response) or away from an empty /
   * failing vault.
   */
  const renderAccountArea = (entries: VaultAccountSummary[] | null) => {
    if (selectedVault === null) {
      // A non-empty list always yields a selection in the default effect;
      // this render happens only before that effect commits.
      return <PendingRow label={t('vaultAccountsLoading')} />;
    }
    if (accountsErrorKey !== null) {
      return (
        <ErrorRetryBox
          messageKey={accountsErrorKey}
          onRetry={() => setGeneration((value) => value + 1)}
          onOpenWorkMode={openWorkMode}
        />
      );
    }
    if (entries === null) {
      return <PendingRow label={t('vaultAccountsLoading')} />;
    }
    if (entries.length === 0) {
      return (
        <div className="flex flex-col gap-4" data-testid="vault-login-empty-vault">
          <div className="bg-muted/40 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">{t('vaultEmptyTitle')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('vaultEmptyBody')}</p>
          </div>
          <Button type="button" variant="outline" onClick={openWorkMode} className="h-11">
            <KeySquare data-icon="inline-start" aria-hidden />
            {t('vaultManageKeys')}
          </Button>
        </div>
      );
    }
    return (
      <>
        <div className="flex flex-col gap-2">
          <Label htmlFor="vault-login-account" className="text-sm font-semibold text-foreground">
            {t('vaultAccountLabel')}
          </Label>
          <select
            id="vault-login-account"
            className={selectClassName}
            value={selectedAccount}
            onChange={(event) =>
              setAccountChoice(
                selectedVault === null || event.target.value === ''
                  ? null
                  : { vaultName: selectedVault, accountName: event.target.value },
              )
            }
            data-testid="vault-login-account-select"
          >
            <option value="">{t('vaultAccountPlaceholder')}</option>
            {entries.map((account) => (
              <option key={account.accountName} value={account.accountName}>
                {account.accountName}
              </option>
            ))}
          </select>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('vaultHelper')}</p>
        </div>

        <Button
          type="submit"
          disabled={selectedAccount === ''}
          className="h-11 w-full text-base"
          size="lg"
          data-testid="vault-login-submit"
        >
          {t('vaultSubmit')}
        </Button>
      </>
    );
  };

  const renderBody = () => {
    if (runtime.state === 'unavailable') {
      return (
        <ErrorRetryBox
          messageKey={`errors.${runtime.code}`}
          onRetry={runtime.retry}
          onOpenWorkMode={openWorkMode}
        />
      );
    }
    if (!manager) {
      return <PendingRow label={t('vaultLoading')} />;
    }
    if (listErrorKey !== null) {
      return (
        <ErrorRetryBox
          messageKey={listErrorKey}
          onRetry={() => {
            setListErrorKey(null);
            void refreshVaults();
          }}
          onOpenWorkMode={openWorkMode}
        />
      );
    }
    if (vaults === null) {
      return <PendingRow label={t('vaultLoading')} />;
    }
    if (vaults.length === 0) {
      return (
        <div className="flex flex-col gap-4" data-testid="vault-login-no-vaults">
          <div className="bg-muted/40 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">{t('vaultNoVaultsTitle')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('vaultNoVaultsBody')}</p>
          </div>
          <Button type="button" onClick={openWorkMode} className="h-11">
            <KeySquare data-icon="inline-start" aria-hidden />
            {t('vaultOpenManager')}
          </Button>
        </div>
      );
    }
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-6" data-testid="vault-login-form">
        <div className="flex flex-col gap-2">
          <Label htmlFor="vault-login-vault" className="text-sm font-semibold text-foreground">
            {t('vaultSelectLabel')}
          </Label>
          <select
            id="vault-login-vault"
            className={selectClassName}
            value={selectedVault ?? ''}
            onChange={(event) => {
              setVaultChoice(event.target.value);
              // The account choice belonged to the previous vault — drop it,
              // so switching back later does not resurrect it either.
              setAccountChoice(null);
            }}
            data-testid="vault-login-vault-select"
          >
            {vaults.map((vault) => (
              <option key={vault.vaultName} value={vault.vaultName}>
                {vault.vaultName}
              </option>
            ))}
          </select>
        </div>

        {renderAccountArea(accounts)}
      </form>
    );
  };

  return (
    <div className={embedded ? 'w-full' : 'mx-auto w-full max-w-md'}>
      <div
        className={
          embedded
            ? ''
            : 'rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8'
        }
        data-testid="vault-login-card"
      >
        {renderBody()}
      </div>
    </div>
  );
}
