'use client';

// Vault manager panel + composition root (A5) — the main view of the Work
// Mode drawer and the place where the vault runtime (registry + manager +
// signing facade) is composed for the component tree.
//
// COMPOSITION ROOT (client only): IndexedDB exists only in the browser, so
// the runtime initializes inside a client effect — never during SSR. The
// registry + manager + facade are a MODULE-LEVEL SINGLETON because the
// unlock-session service is pure memory: two manager instances would hold two
// independent sessions and the drawer could unlock a session no signer ever
// sees. The singleton also survives React StrictMode's double-invoked effects
// (reactStrictMode is enabled in next.config.ts).
//
// Components consume the runtime through <VaultProvider> / useVaultRuntime();
// VaultManagerPanel itself takes the manager/facade as explicit props so unit
// tests inject mocks directly. Nothing here bypasses the manager: the only
// direct vault-lib call is parseVaultEnvelopeJson for user-chosen backup
// files (the sanctioned text-backup entry point — it owns the raw-JSON 1 MiB
// gate), and no component ever sees a WIF, KEK or decrypted payload.
//
// Dialog forms live in separate inner components mounted inside DialogContent
// (Radix unmounts closed dialog content), so every open starts from fresh
// state without reset effects.
//
// UX contracts digested from the A2–A4 layers (see docs/AI-driver/09-vault.md):
//   - merge asks for the TARGET vault password in the dialog and never
//     requires pre-unlocking the target (per-key contract: the password
//     re-encrypts/derives per key, no global unlocked state is formed);
//     merge success LOCKS the target (manager hard contract): the completion
//     dialog says so and the refreshed list shows the locked state;
//   - the merge's preMergeBackup is a MEMORY-ONLY snapshot — the completion
//     dialog forces an explicit Download or Discard before it lets the user
//     continue, and never claims the pre-migration backup is complete before
//     that choice; while the delivery is pending it also swallows X / Esc /
//     overlay close requests (dismiss-proof), and honors them afterwards
//     (equivalent to Continue);
//   - exporting locks this tab's session for the exported vault (revision
//     bump) — the refreshed list shows it locked;
//   - changePassword locks the vault afterwards, and a WRONG old password
//     also locks a previously-unlocked session (both surfaced as info text);
//   - an unlock failure never runs the strength policy (existing passwords
//     keep working); create/import/change-password do (manager/registry).
import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Download,
  GitMerge,
  KeyRound,
  KeySquare,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { modalFormActionButtonClassName } from '@/components/ui/modal-form-actions';
import { parseVaultEnvelopeJson } from '@/lib/vault/envelope';
import { VaultError } from '@/lib/vault/errors';
import { createVaultManager, type VaultManagerExtended } from '@/lib/vault/manager';
import { openVaultRegistry } from '@/lib/vault/registry';
import { createSigningFacade } from '@/lib/vault/signing-facade';
import type {
  SigningFacade,
  SigningMode,
  VaultErrorCode,
  VaultEnvelopeV1,
  VaultSummary,
} from '@/lib/vault/types';
import { KeyConfirmationDialog } from './key-confirmation-dialog';
import { UnlockVaultDialog } from './unlock-vault-dialog';
import { VaultEmptyDialog } from './vault-empty-dialog';
import { VaultKeyManager } from './vault-key-manager';
import { WorkModeSwitcher } from './work-mode-switcher';

// ---------------------------------------------------------------------------
// Composition root: registry + manager + facade singleton
// ---------------------------------------------------------------------------

interface VaultRuntimeReady {
  manager: VaultManagerExtended;
  facade: SigningFacade;
}

let runtimePromise: Promise<VaultRuntimeReady> | null = null;

async function initializeVaultRuntime(): Promise<VaultRuntimeReady> {
  const registry = await openVaultRegistry();
  const manager = createVaultManager(registry);
  // The vault backend shares the manager's session service (one tab = one
  // manager = one service). The privateKey backend is NOT wired yet: A6
  // injects the login-state WIF getter. Until then the facade fails loudly
  // (TypeError) on privateKey signing calls — no signing traffic routes
  // through the facade before A6, so nothing regresses.
  const facade = createSigningFacade(registry, { vaultSigner: manager.createSigner() });
  return { manager, facade };
}

/**
 * The app-wide vault runtime. Resolves once and caches — the manager's
 * unlock-session service is pure memory, so a second instance could never
 * share the session the UI unlocks. Client only (IndexedDB).
 */
export function getVaultRuntime(): Promise<VaultRuntimeReady> {
  if (!runtimePromise) {
    runtimePromise = initializeVaultRuntime();
  }
  return runtimePromise;
}

/**
 * Drop the cached runtime so the next getVaultRuntime() re-initializes.
 * Used by the storage-failure Retry affordance (and by tests).
 */
export function resetVaultRuntime(): void {
  runtimePromise = null;
}

export type VaultRuntime =
  | { state: 'loading' }
  | { state: 'ready'; manager: VaultManagerExtended; facade: SigningFacade }
  | { state: 'unavailable'; code: VaultErrorCode; retry: () => void };

const VaultRuntimeContext = createContext<VaultRuntime>({ state: 'loading' });

/**
 * Client composition-root provider — mount once in the app layout. It owns
 * no data of its own; it only publishes the singleton runtime.
 */
export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [runtime, setRuntime] = useState<VaultRuntime>({ state: 'loading' });
  const [initNonce, setInitNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getVaultRuntime()
      .then((ready) => {
        if (!cancelled) {
          setRuntime({ state: 'ready', manager: ready.manager, facade: ready.facade });
        }
      })
      .catch((error) => {
        console.error('Vault runtime initialization failed', error);
        if (!cancelled) {
          setRuntime({
            state: 'unavailable',
            code: error instanceof VaultError ? error.code : 'VAULT_STORAGE_UNAVAILABLE',
            retry: () => undefined,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initNonce]);

  const retry = useCallback(() => {
    resetVaultRuntime();
    setRuntime({ state: 'loading' });
    setInitNonce((nonce) => nonce + 1);
  }, []);

  const value = useMemo<VaultRuntime>(() => {
    if (runtime.state === 'unavailable') {
      return { state: 'unavailable', code: runtime.code, retry };
    }
    return runtime;
  }, [runtime, retry]);

  return <VaultRuntimeContext.Provider value={value}>{children}</VaultRuntimeContext.Provider>;
}

/** Consume the app vault runtime (loading / ready / unavailable + retry). */
export function useVaultRuntime(): VaultRuntime {
  return useContext(VaultRuntimeContext);
}

/**
 * The Work Mode modal body: resolves the runtime and renders the panel,
 * the storage-unavailable fallback or the loading state. The modal shell
 * (Dialog) lives in app-layout.tsx; B-phase dapp surfaces open that modal
 * via the exported event constant there.
 */
export function VaultWorkModeContent({ focusId }: { focusId?: string | undefined }) {
  const t = useTranslations('vault');
  const runtime = useVaultRuntime();

  if (runtime.state === 'loading') {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('storageInitializing')}
      </div>
    );
  }
  if (runtime.state === 'unavailable') {
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-destructive text-sm font-medium" role="alert">
          {t(`errors.${runtime.code}`)}
        </p>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={runtime.retry}>
            <RotateCcw data-icon="inline-start" aria-hidden />
            {t('retry')}
          </Button>
        </div>
      </div>
    );
  }
  return <VaultManagerPanel manager={runtime.manager} facade={runtime.facade} focusId={focusId} />;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Map any thrown value to a `vault.errors.*` i18n key. VaultError codes ride
 * the mapping table; anything unexpected logs to the console and renders the
 * generic message — raw English error strings never reach the UI.
 */
function vaultErrorKey(error: unknown): string {
  if (error instanceof VaultError) {
    return `errors.${error.code}`;
  }
  console.error('Unexpected vault UI error', error);
  return 'errors.unexpected';
}

/**
 * Scene-level refinement for `VAULT_EMPTY`: the generic errors-table message
 * ("no vault is available") fits the no-vault-to-resolve scenario, but the
 * merge and change-password forms can only see VAULT_EMPTY as the
 * empty-vault password-anchor rejection (both name their target explicitly,
 * so a missing vault surfaces as VAULT_NOT_FOUND instead). Those two scenes
 * get dedicated `vault.*` i18n keys with actionable copy — the errors table
 * itself stays locked to VAULT_ERROR_CODES by vault-i18n-errors.test.ts.
 */
function sceneErrorKey(error: unknown, emptySceneKey: string): string {
  if (error instanceof VaultError && error.code === 'VAULT_EMPTY') return emptySceneKey;
  return vaultErrorKey(error);
}

function formatVaultTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Read a user-chosen backup file as text. FileReader (rather than
 * Blob.prototype.text) so the flow is testable in jsdom, which does not
 * implement Blob#text.
 */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('reading the backup file failed'));
    };
    reader.readAsText(file);
  });
}

/**
 * Download an envelope as a JSON file. Browser-side only — the backup never
 * touches the server (the relay architecture keeps vault data device-local).
 */
function downloadVaultBackupFile(envelope: VaultEnvelopeV1, hint: 'backup' | 'pre-merge'): void {
  const safeName = envelope.vaultName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `steem-wallet-vault-${safeName}-${hint}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke only after the click had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Inline destructive error box (the transfer-form pattern). */
function ErrorBox({ messageKey }: { messageKey: string }) {
  const t = useTranslations('vault');
  return (
    <div className="border-destructive/20 bg-destructive/10 rounded-md border p-3" role="alert">
      <p className="text-destructive text-sm font-medium">{t(messageKey)}</p>
    </div>
  );
}

function PendingRow({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2 px-1 py-2 text-sm">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </p>
  );
}

// ---------------------------------------------------------------------------
// VaultManagerPanel
// ---------------------------------------------------------------------------

type PanelView = 'list' | 'create' | 'import' | 'keys';

export interface VaultManagerPanelProps {
  /** Injected by tests; normally comes from useVaultRuntime via VaultWorkModeContent. */
  manager: VaultManagerExtended | null;
  facade: SigningFacade | null;
  /** id forwarded to the mode switcher (the B-phase dapp hook focuses it). */
  focusId?: string | undefined;
}

export function VaultManagerPanel({ manager, facade, focusId }: VaultManagerPanelProps) {
  const t = useTranslations('vault');
  const [mode, setMode] = useState<SigningMode | null>(null);
  const [modeLoadFailed, setModeLoadFailed] = useState(false);
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [listErrorKey, setListErrorKey] = useState<string | null>(null);
  // The load failure's raw VaultError code (null when non-VaultError). The
  // cleanup escape hatch is offered ONLY for VAULT_ENVELOPE_INVALID — the
  // code that incompatible (old-format) stored records produce.
  const [listErrorCode, setListErrorCode] = useState<VaultErrorCode | null>(null);
  const [view, setView] = useState<PanelView>('list');
  // Vault whose key directory the 'keys' view shows (display name).
  const [keysTarget, setKeysTarget] = useState<string | null>(null);
  const [emptyDialogOpen, setEmptyDialogOpen] = useState(false);
  const emptyPromptShownRef = useRef(false);
  // Current mode for async callbacks (set through the switcher callback).
  const modeRef = useRef<SigningMode | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [actionInfoKey, setActionInfoKey] = useState<string | null>(null);
  const [busyVault, setBusyVault] = useState<string | null>(null);

  // Per-vault dialog targets (vault display names).
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<{
    vaultName: string;
    preMergeBackup: VaultEnvelopeV1 | null;
  } | null>(null);
  const [keyConfirm, setKeyConfirm] = useState<{
    vaultName: string;
    context: 'created' | 'imported';
  } | null>(null);
  // Explicit "clear incompatible vault data" escape hatch (R1): when the list
  // fails with VAULT_ENVELOPE_INVALID because this device still holds records
  // written by the never-shipped whole-vault format, the user can purge them
  // after confirming. No migration layer exists by design, so this is the
  // sanctioned way to make the panel usable again.
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  // Removed-record count from a successful cleanup, rendered once as an info
  // banner (null = nothing to show).
  const [cleanupDoneCount, setCleanupDoneCount] = useState<number | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const refreshVaults = useCallback(async () => {
    if (!manager) return;
    try {
      const list = await manager.listVaults();
      setVaults(list);
      setListErrorKey(null);
      setListErrorCode(null);
      // Empty state: entering Vault Mode with zero vaults prompts the three
      // options once per drawer session ("continue browsing" just closes it).
      if (
        list.length === 0 &&
        modeRef.current === 'vault' &&
        !emptyPromptShownRef.current
      ) {
        emptyPromptShownRef.current = true;
        setEmptyDialogOpen(true);
      }
    } catch (error) {
      console.error('Failed to list vaults', error);
      setListErrorKey(vaultErrorKey(error));
      setListErrorCode(error instanceof VaultError ? error.code : null);
    }
  }, [manager]);

  useEffect(() => {
    if (mode === 'vault' && manager) {
      // Defer past the effect body: refreshVaults can set state before its
      // first await on the null-manager early-return path, which
      // react-hooks/set-state-in-effect forbids inside an effect.
      void Promise.resolve().then(refreshVaults);
    }
  }, [mode, manager, refreshVaults]);

  const clearFeedback = () => {
    setActionErrorKey(null);
    setActionInfoKey(null);
    setCleanupDoneCount(null);
  };

  /** Run a simple (no-dialog) row action with busy + error/info feedback. */
  const runRowAction = async (vault: VaultSummary, action: () => Promise<void>, infoKey?: string) => {
    clearFeedback();
    setBusyVault(vault.vaultName);
    try {
      await action();
      await refreshVaults();
      if (infoKey) setActionInfoKey(infoKey);
    } catch (error) {
      setActionErrorKey(vaultErrorKey(error));
    } finally {
      setBusyVault(null);
    }
  };

  const onCreatedOrImported = (summary: VaultSummary, context: 'created' | 'imported') => {
    setView('list');
    setKeyConfirm({ vaultName: summary.vaultName, context });
    void refreshVaults();
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <WorkModeSwitcher
        facade={facade}
        onModeChange={setMode}
        onLoadStateChange={setModeLoadFailed}
        focusId={focusId}
      />
      <Separator />

      {mode === null && !modeLoadFailed && <PendingRow label={t('modeLoading')} />}
      {mode === null && modeLoadFailed && (
        // The switcher already shows the error + Retry next to its control;
        // the body just drops the forever-spinner for a short notice.
        <div className="bg-muted/40 rounded-lg border p-3" data-testid="mode-unavailable">
          <p className="text-muted-foreground text-sm">{t('modeUnavailable')}</p>
        </div>
      )}

      {mode === 'privateKey' && (
        <div className="bg-muted/40 rounded-lg border p-3">
          <p className="text-sm font-medium">{t('legacyActiveTitle')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('legacyActiveBody')}</p>
        </div>
      )}

      {mode === 'vault' && !manager && <ErrorBox messageKey="errors.VAULT_STORAGE_UNAVAILABLE" />}

      {mode === 'vault' && manager && (
        <div className="flex flex-col gap-3" data-testid="vault-section">
          {view === 'list' && (
            <>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide uppercase">{t('listTitle')}</h3>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => setView('create')}>
                    <Plus data-icon="inline-start" aria-hidden />
                    {t('createVault')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setView('import')}
                  >
                    <Upload data-icon="inline-start" aria-hidden />
                    {t('importBackup')}
                  </Button>
                </div>
              </div>

              {actionErrorKey && <ErrorBox messageKey={actionErrorKey} />}
              {actionInfoKey && (
                <div className="bg-muted/40 rounded-md border p-3">
                  <p className="text-sm">{t(actionInfoKey)}</p>
                </div>
              )}
              {cleanupDoneCount !== null && (
                <div className="bg-muted/40 rounded-md border p-3">
                  <p className="text-sm">{t('cleanupDone', { count: cleanupDoneCount })}</p>
                </div>
              )}
              {listErrorKey && (
                <div className="flex flex-col gap-2">
                  <ErrorBox messageKey={listErrorKey} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshVaults()}
                    >
                      <RotateCcw data-icon="inline-start" aria-hidden />
                      {t('retry')}
                    </Button>
                    {/* Escape hatch ONLY for unreadable-record load failures:
                        other codes (e.g. storage unavailable) stay Retry-only. */}
                    {listErrorCode === 'VAULT_ENVELOPE_INVALID' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setCleanupDialogOpen(true)}
                        data-testid="vault-cleanup-incompatible"
                      >
                        <Trash2 data-icon="inline-start" aria-hidden />
                        {t('cleanupIncompatible')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {vaults === null && !listErrorKey && <PendingRow label={t('listLoading')} />}

              {vaults?.length === 0 && (
                <div className="bg-muted/40 rounded-lg border border-dashed p-4 text-center">
                  <p className="text-muted-foreground text-sm">{t('emptyInline')}</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <Button type="button" size="sm" onClick={() => setView('create')}>
                      {t('emptyCreate')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setView('import')}
                    >
                      {t('emptyImport')}
                    </Button>
                  </div>
                </div>
              )}

              <ul className="flex flex-col gap-2">
                {vaults?.map((vault) => (
                  <li
                    key={vault.vaultName}
                    className="rounded-lg border p-3"
                    data-testid="vault-row"
                    data-vault={vault.vaultName}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{vault.vaultName}</span>
                          {vault.active && (
                            <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
                              {t('activeBadge')}
                            </span>
                          )}
                          <span
                            className={
                              vault.locked
                                ? 'bg-muted text-muted-foreground rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase'
                                : 'rounded-sm border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400'
                            }
                          >
                            {vault.locked ? t('lockedBadge') : t('unlockedBadge')}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t('createdAt', { date: formatVaultTimestamp(vault.createdAt) })}
                          {' · '}
                          {t('updatedAt', { date: formatVaultTimestamp(vault.updatedAt) })}
                          {' · '}
                          {vault.lastBackupAt === null
                            ? t('neverBackedUp')
                            : t('lastBackupAt', {
                                date: formatVaultTimestamp(vault.lastBackupAt),
                              })}
                        </span>
                      </div>
                      <VaultRowMenu
                        vault={vault}
                        busy={busyVault === vault.vaultName}
                        onActivate={() =>
                          void runRowAction(vault, () => manager.activateVault(vault.vaultName))
                        }
                        onUnlock={() => setUnlockTarget(vault.vaultName)}
                        onLock={() =>
                          void runRowAction(vault, () => manager.lockVault(vault.vaultName))
                        }
                        onManageKeys={() => {
                          clearFeedback();
                          setKeysTarget(vault.vaultName);
                          setView('keys');
                        }}
                        onRename={() => setRenameTarget(vault.vaultName)}
                        onChangePassword={() => setPasswordTarget(vault.vaultName)}
                        onExport={() =>
                          void runRowAction(
                            vault,
                            async () => {
                              const envelope = await manager.exportVault(vault.vaultName);
                              downloadVaultBackupFile(envelope, 'backup');
                            },
                            // The export bumps the revision, ending this tab's
                            // session for the vault — state it explicitly.
                            'exportSuccess',
                          )
                        }
                        onMerge={() => setMergeTarget(vault.vaultName)}
                        onDelete={() => setDeleteTarget(vault.vaultName)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {view === 'create' && (
            <CreateVaultForm
              manager={manager}
              onCancel={() => setView('list')}
              onCreated={(summary) => onCreatedOrImported(summary, 'created')}
            />
          )}
          {view === 'import' && (
            <ImportBackupForm
              manager={manager}
              onCancel={() => setView('list')}
              onImported={(summary) => onCreatedOrImported(summary, 'imported')}
            />
          )}
          {view === 'keys' && keysTarget !== null && (
            <VaultKeyManager
              vaultName={keysTarget}
              manager={manager}
              onBack={() => {
                setView('list');
                setKeysTarget(null);
              }}
            />
          )}
        </div>
      )}

      <VaultEmptyDialog
        open={emptyDialogOpen}
        onOpenChange={setEmptyDialogOpen}
        onCreate={() => setView('create')}
        onImport={() => setView('import')}
      />

      <UnlockVaultDialog
        open={unlockTarget !== null}
        onOpenChange={(next) => !next && setUnlockTarget(null)}
        vaultName={unlockTarget ?? ''}
        manager={manager}
        onUnlocked={() => {
          clearFeedback();
          void refreshVaults();
        }}
      />

      <RenameVaultDialog
        open={renameTarget !== null}
        onOpenChange={(next) => !next && setRenameTarget(null)}
        vaultName={renameTarget ?? ''}
        manager={manager}
        onRenamed={() => void refreshVaults()}
      />

      <ChangeVaultPasswordDialog
        open={passwordTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPasswordTarget(null);
        }}
        vaultName={passwordTarget ?? ''}
        manager={manager}
        onChanged={() => {
          clearFeedback();
          setActionInfoKey('changePasswordSuccess');
          void refreshVaults();
        }}
      />

      <DeleteVaultDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        vaultName={deleteTarget ?? ''}
        manager={manager}
        onDeleted={() => void refreshVaults()}
      />

      <CleanupIncompatibleVaultsDialog
        open={cleanupDialogOpen}
        onOpenChange={setCleanupDialogOpen}
        manager={manager}
        onCleaned={(count) => {
          setCleanupDialogOpen(false);
          clearFeedback();
          setCleanupDoneCount(count);
          void refreshVaults();
        }}
      />

      <MergeBackupDialog
        open={mergeTarget !== null}
        onOpenChange={(next) => !next && setMergeTarget(null)}
        vaultName={mergeTarget ?? ''}
        manager={manager}
        onMerged={(result) => {
          setMergeResult(result);
          void refreshVaults();
        }}
      />

      {mergeResult !== null && (
        <MergeCompleteDialog
          result={mergeResult}
          onClose={() => {
            setMergeResult(null);
            void refreshVaults();
          }}
        />
      )}

      <KeyConfirmationDialog
        open={keyConfirm !== null}
        onOpenChange={(next) => !next && setKeyConfirm(null)}
        context={keyConfirm?.context ?? 'created'}
        vaultName={keyConfirm?.vaultName ?? ''}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row action menu
// ---------------------------------------------------------------------------

interface VaultRowMenuProps {
  vault: VaultSummary;
  busy: boolean;
  onActivate: () => void;
  onUnlock: () => void;
  onLock: () => void;
  onManageKeys: () => void;
  onRename: () => void;
  onChangePassword: () => void;
  onExport: () => void;
  onMerge: () => void;
  onDelete: () => void;
}

function VaultRowMenu({
  vault,
  busy,
  onActivate,
  onUnlock,
  onLock,
  onManageKeys,
  onRename,
  onChangePassword,
  onExport,
  onMerge,
  onDelete,
}: VaultRowMenuProps) {
  const t = useTranslations('vault');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={busy}>
          {busy && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
          {t('manage')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {!vault.active && (
          <DropdownMenuItem onClick={onActivate}>{t('actionActivate')}</DropdownMenuItem>
        )}
        {vault.locked ? (
          <DropdownMenuItem onClick={onUnlock}>
            <Unlock aria-hidden />
            {t('actionUnlock')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onLock}>
            <Lock aria-hidden />
            {t('actionLock')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onManageKeys}>
          <KeySquare aria-hidden />
          {t('actionManageKeys')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}>
          <Pencil aria-hidden />
          {t('actionRename')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onChangePassword}>
          <KeyRound aria-hidden />
          {t('actionChangePassword')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExport}>
          <Download aria-hidden />
          {t('actionExport')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMerge}>
          <GitMerge aria-hidden />
          {t('actionMerge')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} variant="destructive">
          <Trash2 aria-hidden />
          {t('actionDelete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateVaultForm({
  manager,
  onCreated,
  onCancel,
}: {
  manager: VaultManagerExtended;
  onCreated: (summary: VaultSummary) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mismatch = confirmPassword !== '' && password !== confirmPassword;
  const canSubmit = name !== '' && password !== '' && confirmPassword !== '' && !mismatch && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const summary = await manager.createVault({ vaultName: name, password });
      onCreated(summary);
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="vault-create-form">
      <h3 className="text-sm font-semibold">{t('createTitle')}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-create-name">{t('nameLabel')}</Label>
        <Input
          id="vault-create-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('namePlaceholder')}
          disabled={busy}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-create-password">{t('passwordLabel')}</Label>
        <Input
          id="vault-create-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('passwordPlaceholder')}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-create-confirm">{t('confirmPasswordLabel')}</Label>
        <Input
          id="vault-create-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {mismatch && (
        <p className="text-destructive text-sm font-medium" role="alert">
          {t('passwordMismatch')}
        </p>
      )}
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <p className="text-muted-foreground text-xs">{t('createPolicyHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button type="submit" disabled={!canSubmit} className={modalFormActionButtonClassName}>
          {busy ? t('creating') : t('createButton')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className={modalFormActionButtonClassName}
        >
          {t('backToList')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Independent import form
// ---------------------------------------------------------------------------

function ImportBackupForm({
  manager,
  onImported,
  onCancel,
}: {
  manager: VaultManagerExtended;
  onImported: (summary: VaultSummary) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canSubmit = file !== null && name !== '' && password !== '' && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !file) return;
    setBusy(true);
    setErrorKey(null);
    try {
      // parseVaultEnvelopeJson owns the raw-JSON size gate and the four-field
      // fail-closed validation (single-password contract: the backup password
      // also becomes the new vault's password and must pass the current
      // policy — a weak source password is rejected by design).
      const envelope = parseVaultEnvelopeJson(await readFileText(file));
      const { summary } = await manager.importVaultDetailed({
        mode: 'independent',
        envelope,
        password,
        vaultName: name,
      });
      onImported(summary);
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="vault-import-form">
      <h3 className="text-sm font-semibold">{t('importTitle')}</h3>
      <p className="text-muted-foreground text-sm">{t('importDescription')}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-import-file">{t('importFileLabel')}</Label>
        <Input
          id="vault-import-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-import-name">{t('importNameLabel')}</Label>
        <Input
          id="vault-import-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-import-password">{t('importPasswordLabel')}</Label>
        <Input
          id="vault-import-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <div className="grid grid-cols-2 gap-3">
        <Button type="submit" disabled={!canSubmit} className={modalFormActionButtonClassName}>
          {busy ? t('importing') : t('importButton')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className={modalFormActionButtonClassName}
        >
          {t('backToList')}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rename dialog
// ---------------------------------------------------------------------------

function RenameVaultDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  manager: VaultManagerExtended | null;
  onRenamed: () => void;
}) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('renameTitle')}</DialogTitle>
          <DialogDescription>{t('renameDescription', { name: vaultName })}</DialogDescription>
        </DialogHeader>
        {open && (
          <RenameVaultForm
            vaultName={vaultName}
            manager={manager}
            onRenamed={() => {
              onRenamed();
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameVaultForm({
  vaultName,
  manager,
  onRenamed,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onRenamed: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || busy || newName === '') return;
    setBusy(true);
    setErrorKey(null);
    try {
      await manager.renameVault(vaultName, newName);
      onRenamed();
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-rename-new">{t('newNameLabel')}</Label>
        <Input
          id="vault-rename-new"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <DialogFooter>
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
          disabled={busy || newName === ''}
          className={modalFormActionButtonClassName}
        >
          {busy ? t('renaming') : t('renameButton')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Change password dialog
// ---------------------------------------------------------------------------

function ChangeVaultPasswordDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  manager: VaultManagerExtended | null;
  onChanged: () => void;
}) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('changePasswordTitle')}</DialogTitle>
          <DialogDescription>
            {t('changePasswordDescription', { name: vaultName })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ChangeVaultPasswordForm
            vaultName={vaultName}
            manager={manager}
            onChanged={() => {
              onChanged();
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangeVaultPasswordForm({
  vaultName,
  manager,
  onChanged,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;
  const canSubmit =
    oldPassword !== '' && newPassword !== '' && confirmPassword !== '' && !mismatch && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || !canSubmit) return;
    setBusy(true);
    setErrorKey(null);
    try {
      // changePassword re-encrypts with a fresh salt and LOCKS afterwards; a
      // wrong old password also locks a previously-unlocked session (A4) —
      // both outcomes are surfaced by the host panel's info banner.
      await manager.changePassword(vaultName, oldPassword, newPassword);
      onChanged();
    } catch (error) {
      setErrorKey(sceneErrorKey(error, 'changePasswordEmpty'));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-password-old">{t('oldPasswordLabel')}</Label>
        <Input
          id="vault-password-old"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-password-new">{t('newPasswordLabel')}</Label>
        <Input
          id="vault-password-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder={t('passwordPlaceholder')}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-password-confirm">{t('confirmNewPasswordLabel')}</Label>
        <Input
          id="vault-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {mismatch && (
        <p className="text-destructive text-sm font-medium" role="alert">
          {t('passwordMismatch')}
        </p>
      )}
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <p className="text-muted-foreground text-xs">{t('changePasswordNote')}</p>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className={modalFormActionButtonClassName}
        >
          {t('cancelAction')}
        </Button>
        <Button type="submit" disabled={!canSubmit} className={modalFormActionButtonClassName}>
          {busy ? t('changingPassword') : t('changePasswordButton')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Delete dialog
// ---------------------------------------------------------------------------

function DeleteVaultDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  manager: VaultManagerExtended | null;
  onDeleted: () => void;
}) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription', { name: vaultName })}</DialogDescription>
        </DialogHeader>
        {open && (
          <DeleteVaultForm
            vaultName={vaultName}
            manager={manager}
            onDeleted={() => {
              onDeleted();
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteVaultForm({
  vaultName,
  manager,
  onDeleted,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || busy || password === '') return;
    setBusy(true);
    setErrorKey(null);
    try {
      await manager.removeVault(vaultName, password);
      onDeleted();
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p className="text-destructive text-sm font-medium">{t('deleteWarning')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-delete-password">{t('deletePasswordLabel')}</Label>
        <Input
          id="vault-delete-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          autoFocus
        />
      </div>
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <DialogFooter>
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
          disabled={busy || password === ''}
          className={modalFormActionButtonClassName}
        >
          {busy ? t('deleting') : t('deleteButton')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cleanup dialog — the explicit "clear incompatible vault data" escape hatch
// ---------------------------------------------------------------------------

/**
 * Confirmation dialog for purging records this build cannot read (R1). The
 * old whole-vault format never shipped publicly and has NO migration layer by
 * design, so the panel offers this escape hatch only where it is actually
 * needed: when the vault list failed to load with VAULT_ENVELOPE_INVALID.
 * The dialog must state, before the destructive button is reachable, that
 * (a) only unrecognized records are removed — readable vaults and settings
 * are unaffected — and (b) the removal is unrecoverable, and backups exported
 * by the old version cannot be imported here either.
 */
function CleanupIncompatibleVaultsDialog({
  open,
  onOpenChange,
  manager,
  onCleaned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: VaultManagerExtended | null;
  onCleaned: (removedCount: number) => void;
}) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cleanupTitle')}</DialogTitle>
          <DialogDescription>{t('cleanupDescription')}</DialogDescription>
        </DialogHeader>
        {open && (
          <CleanupIncompatibleVaultsForm
            manager={manager}
            onCleaned={onCleaned}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CleanupIncompatibleVaultsForm({
  manager,
  onCleaned,
  onCancel,
}: {
  manager: VaultManagerExtended | null;
  onCleaned: (removedCount: number) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await manager.cleanupUnreadableVaults();
      onCleaned(result.removed.length);
    } catch (error) {
      setErrorKey(vaultErrorKey(error));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p className="text-destructive text-sm font-medium">{t('cleanupWarning')}</p>
      </div>
      <p className="text-muted-foreground text-sm">{t('cleanupScopeNote')}</p>
      <p className="text-muted-foreground text-sm">{t('cleanupNoPassword')}</p>
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <DialogFooter>
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
          {busy ? t('cleaning') : t('cleanupConfirm')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Merge dialog (target password authenticates the target per key)
// ---------------------------------------------------------------------------

function MergeBackupDialog({
  open,
  onOpenChange,
  vaultName,
  manager,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultName: string;
  manager: VaultManagerExtended | null;
  onMerged: (result: { vaultName: string; preMergeBackup: VaultEnvelopeV1 | null }) => void;
}) {
  const t = useTranslations('vault');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mergeTitle')}</DialogTitle>
          <DialogDescription>{t('mergeDescription', { name: vaultName })}</DialogDescription>
        </DialogHeader>
        {open && (
          <MergeBackupForm
            vaultName={vaultName}
            manager={manager}
            onMerged={(result) => {
              onMerged(result);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeBackupForm({
  vaultName,
  manager,
  onMerged,
  onCancel,
}: {
  vaultName: string;
  manager: VaultManagerExtended | null;
  onMerged: (result: { vaultName: string; preMergeBackup: VaultEnvelopeV1 | null }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('vault');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const canSubmit = file !== null && password !== '' && targetPassword !== '' && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manager || !canSubmit || !file) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const envelope = parseVaultEnvelopeJson(await readFileText(file));
      // Per-key merge contract: the target stays locked — targetPassword
      // authenticates the target inside the merge (the manager derives the
      // target KEK per key and never opens a global unlocked state). Success
      // still LOCKS the target (A4 hard contract) and returns the
      // memory-only preMergeBackup that the completion dialog must deliver
      // before claiming anything is done.
      const result = await manager.importVaultDetailed({
        mode: 'merge',
        envelope,
        password,
        targetVaultName: vaultName,
        targetPassword,
      });
      onMerged({ vaultName: result.summary.vaultName, preMergeBackup: result.preMergeBackup });
    } catch (error) {
      setErrorKey(sceneErrorKey(error, 'mergeTargetEmpty'));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-merge-file">{t('mergeFileLabel')}</Label>
        <Input
          id="vault-merge-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-merge-password">{t('mergePasswordLabel')}</Label>
        <Input
          id="vault-merge-password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="vault-merge-target-password">{t('mergeTargetPasswordLabel')}</Label>
        <Input
          id="vault-merge-target-password"
          type="password"
          autoComplete="off"
          value={targetPassword}
          onChange={(event) => setTargetPassword(event.target.value)}
          disabled={busy}
        />
      </div>
      {errorKey && <ErrorBox messageKey={errorKey} />}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={busy}
          className={modalFormActionButtonClassName}
        >
          {t('cancelAction')}
        </Button>
        <Button type="submit" disabled={!canSubmit} className={modalFormActionButtonClassName}>
          {busy ? t('merging') : t('mergeButton')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Merge completion dialog — preMergeBackup delivery (blueprint contract)
// ---------------------------------------------------------------------------

/**
 * Post-merge flow. Until the user DOWNLOADS the pre-merge backup or
 * EXPLICITLY discards it, the dialog keeps stating that the backup has NOT
 * been saved and "Continue" stays disabled — the memory-only snapshot alone
 * is never presented as a completed backup (kickoff A5 acceptance). While
 * the delivery is pending, radix close requests (X / Esc / overlay) are
 * swallowed; after the explicit choice any of them closes like Continue.
 *
 * The panel mounts this component only while a merge result exists, so the
 * `delivery` state starts from 'pending' on every merge.
 */
function MergeCompleteDialog({
  result,
  onClose,
}: {
  result: { vaultName: string; preMergeBackup: VaultEnvelopeV1 | null };
  onClose: () => void;
}) {
  const t = useTranslations('vault');
  // Owned here (not in the body) so the close interception and the body's
  // buttons share one source of truth.
  const [delivery, setDelivery] = useState<'pending' | 'saved' | 'discarded'>('pending');
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Radix requests close (X / overlay / Esc). A pending delivery must
        // stay dismiss-proof; once the choice was made, closing is Continue.
        if (!next && delivery !== 'pending') {
          onClose();
        }
      }}
    >
      <DialogContent className="z-[60] sm:max-w-md" data-testid="vault-merge-complete">
        <DialogHeader>
          <DialogTitle>{t('mergeCompleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('mergeLockedNotice', { name: result.vaultName })}
          </DialogDescription>
        </DialogHeader>
        <MergeCompleteBody
          preMergeBackup={result.preMergeBackup}
          delivery={delivery}
          onDeliveryChange={setDelivery}
          onFinished={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function MergeCompleteBody({
  preMergeBackup,
  delivery,
  onDeliveryChange,
  onFinished,
}: {
  preMergeBackup: VaultEnvelopeV1 | null;
  delivery: 'pending' | 'saved' | 'discarded';
  onDeliveryChange: (delivery: 'pending' | 'saved' | 'discarded') => void;
  onFinished: () => void;
}) {
  const t = useTranslations('vault');

  const download = () => {
    if (preMergeBackup !== null) {
      downloadVaultBackupFile(preMergeBackup, 'pre-merge');
      onDeliveryChange('saved');
    } else {
      // Defensive: merge flows always carry a snapshot; independent imports
      // never open this dialog.
      onDeliveryChange('discarded');
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        {preMergeBackup !== null ? (
          <>
            {delivery === 'pending' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-destructive text-sm font-medium" data-testid="merge-backup-pending">
                  {t('mergeBackupPending')}
                </p>
              </div>
            )}
            {delivery === 'saved' && (
              <div className="bg-muted/40 rounded-md border p-3">
                <p className="text-sm" data-testid="merge-backup-saved">
                  {t('mergeBackupSaved')}
                </p>
              </div>
            )}
            {delivery === 'discarded' && (
              <div className="bg-muted/40 rounded-md border p-3">
                <p className="text-sm" data-testid="merge-backup-discarded">
                  {t('mergeBackupDiscarded')}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={download}
                disabled={delivery === 'saved'}
                data-testid="vault-merge-download-backup"
              >
                <Download data-icon="inline-start" aria-hidden />
                {t('mergeBackupDownload')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onDeliveryChange('discarded')}
                disabled={delivery !== 'pending'}
                data-testid="vault-merge-discard-backup"
              >
                {t('mergeBackupDiscard')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t('mergeNoPreMergeBackup')}</p>
        )}
      </div>
      <DialogFooter>
        <Button
          type="button"
          disabled={delivery === 'pending'}
          onClick={onFinished}
          className={modalFormActionButtonClassName}
          data-testid="vault-merge-continue"
        >
          {t('mergeContinue')}
        </Button>
      </DialogFooter>
    </>
  );
}
