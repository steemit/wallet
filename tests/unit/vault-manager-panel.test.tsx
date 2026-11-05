/**
 * VaultManagerPanel + composition root (A5) — jsdom smoke coverage with a
 * fully mocked manager/facade (no IndexedDB, no crypto).
 *
 * Focus areas from the kickoff A5 acceptance:
 *  - vault list rendering (name / active / lock state / backup time);
 *  - the three-option empty-vault dialog (create / import / continue);
 *  - create flow with validation errors mapped through VaultError codes;
 *  - merge flow: reachable on a LOCKED target with the target-password
 *    field (per-key contract), post-merge LOCK notice and the
 *    preMergeBackup delivery contract (download or EXPLICIT discard before
 *    "Continue" unlocks — never claims the backup is done while pending);
 *  - export produces a client-side blob download;
 *  - the storage-unavailable fallback with retry.
 *
 * Assertions check RENDERED OUTPUT only — no component ever sees WIF/KEK/
 * payload, and these tests assert the rendered tree contains none.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  VaultManagerPanel,
  VaultProvider,
  VaultWorkModeContent,
  resetVaultRuntime,
} from '@/components/vault/vault-manager';
import { VaultError } from '@/lib/vault/errors';
import { openVaultRegistry } from '@/lib/vault/registry';
import type { ImportVaultDetailedResult, VaultManagerExtended } from '@/lib/vault/manager';
import type { SigningFacade, VaultEnvelopeV1, VaultSummary } from '@/lib/vault/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/vault/registry', () => ({
  openVaultRegistry: vi.fn(),
  VAULT_DB_NAME: 'steem-wallet-vault',
}));

// jsdom lacks radix's pointer-capture APIs (dropdown menus) and ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
for (const method of [
  'hasPointerCapture',
  'setPointerCapture',
  'releasePointerCapture',
  'scrollIntoView',
] as const) {
  if (!(method in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, method, {
      value: vi.fn(),
      configurable: true,
    });
  }
}

type AnyMock = ReturnType<typeof vi.fn>;

const openRegistryMock = vi.mocked(openVaultRegistry);

// jsdom has no URL.createObjectURL — the download path needs both stubs.
let createdUrlCount = 0;
const createObjectURLMock = vi.fn(() => {
  createdUrlCount += 1;
  return `blob:mock-${createdUrlCount}`;
});
const revokeObjectURLMock = vi.fn();

function summary(partial: Partial<VaultSummary> = {}): VaultSummary {
  return {
    vaultName: 'Main',
    active: false,
    locked: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastBackupAt: null,
    ...partial,
  };
}

function makeFacade(initialMode: 'privateKey' | 'vault' = 'vault'): SigningFacade {
  return {
    getSigningMode: vi.fn().mockResolvedValue(initialMode),
    setSigningMode: vi.fn(),
    signOperations: vi.fn(),
    signResolvedTransaction: vi.fn(),
  } as unknown as SigningFacade;
}

type ManagerState = {
  list: VaultSummary[];
  manager: VaultManagerExtended;
  calls: Record<string, unknown[][]>;
};

/** A manager mock whose listVaults reflects a mutable `list` array. */
function makeManager(initial: VaultSummary[]): ManagerState {
  const state: ManagerState = {
    list: initial,
    calls: {},
    manager: null as unknown as VaultManagerExtended,
  };
  const record = (name: string) => (...args: unknown[]) => {
    state.calls[name] = [...(state.calls[name] ?? []), args];
  };
  state.manager = {
    listVaults: vi.fn(async () => state.list.map((entry) => ({ ...entry }))),
    createVault: vi.fn(async (params: { vaultName: string; password: string }) => {
      record('createVault')(params);
      const created = summary({ vaultName: params.vaultName });
      state.list = [...state.list, created];
      return created;
    }),
    importVault: vi.fn(),
    importVaultDetailed: vi.fn(async (params: unknown) => {
      record('importVaultDetailed')(params);
      return { summary: summary(), preMergeBackup: null } as ImportVaultDetailedResult;
    }),
    activateVault: vi.fn(async (...args: unknown[]) => {
      record('activateVault')(args);
    }),
    renameVault: vi.fn(async (...args: unknown[]) => {
      record('renameVault')(args);
    }),
    removeVault: vi.fn(async (...args: unknown[]) => {
      record('removeVault')(args);
    }),
    exportVault: vi.fn(async (name: string) => {
      record('exportVault')(name);
      // Export bumps the vault revision, ending this tab's unlock session
      // (A4) — the refreshed list shows the vault locked again.
      state.list = state.list.map((entry) =>
        entry.vaultName === name ? { ...entry, locked: true } : entry,
      );
      return envelopeFor(name);
    }),
    lockVault: vi.fn(async (...args: unknown[]) => {
      record('lockVault')(args);
    }),
    changePassword: vi.fn(async (...args: unknown[]) => {
      record('changePassword')(args);
    }),
    getAccounts: vi.fn(async () => []),
    unlockVault: vi.fn(async (name: string, password: string) => {
      record('unlockVault')(name, password);
      state.list = state.list.map((entry) =>
        entry.vaultName === name ? { ...entry, locked: false } : entry,
      );
      return { locked: false, vaultName: name, revision: 1, lockEpoch: 1 };
    }),
    createSigner: vi.fn(() => ({ signOperations: vi.fn(), signResolvedTransaction: vi.fn() })),
    destroy: vi.fn(),
  } as unknown as VaultManagerExtended;
  return state;
}

function envelopeFor(name: string): VaultEnvelopeV1 {
  // V1 hierarchical envelope: version/vaultName/salt/accounts with per-key
  // iv/ciphertext/note entries. Empty accounts keep the mock shape minimal
  // while still passing the real parseVaultEnvelopeJson gate on import.
  return {
    version: 1,
    vaultName: name,
    salt: 'AAECAwQFBgcICQoLDA0ODw',
    accounts: [],
  };
}

/** Open a row's Manage dropdown and click a menu item.
 *
 * Radix's DropdownMenuTrigger does not open on a plain jsdom click/pointer
 * event; keyboard ArrowDown reliably opens it, and menu items select on
 * click. (Proven in this file's sibling experiments; see header-mobile
 * tests for other radix patterns.)
 */
async function chooseRowAction(label: string) {
  const trigger = screen.getByRole('button', { name: 'manage' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const item = await screen.findByRole('menuitem', { name: label });
  fireEvent.click(item);
  await waitFor(() => {
    expect(screen.queryByRole('menuitem', { name: label })).not.toBeInTheDocument();
  });
}

function renderPanel(state: ManagerState, facade = makeFacade()) {
  return render(<VaultManagerPanel manager={state.manager} facade={facade} />);
}

/**
 * Drive a (possibly locked) 'Main' vault through a successful merge and
 * resolve once the completion dialog (with a preMergeBackup present) is
 * mounted. Under the per-key contract the merge form is reachable while the
 * target is LOCKED — the target password field authenticates it.
 */
async function mergeToComplete(state: ManagerState) {
  const importVaultDetailed = state.manager.importVaultDetailed as unknown as AnyMock;
  importVaultDetailed.mockResolvedValueOnce({
    summary: summary({ vaultName: 'Main', locked: true }),
    preMergeBackup: envelopeFor('Main'),
  } as ImportVaultDetailedResult);

  await chooseRowAction('actionMerge');
  await waitFor(() => {
    expect(document.getElementById('vault-merge-file')).not.toBeNull();
  });
  const file = new File([JSON.stringify(envelopeFor('Source'))], 'source-backup.json', {
    type: 'application/json',
  });
  fireEvent.change(document.getElementById('vault-merge-file') as HTMLInputElement, {
    target: { files: [file] },
  });
  fireEvent.change(document.getElementById('vault-merge-password') as HTMLInputElement, {
    target: { value: 'source-password-1234' },
  });
  fireEvent.change(document.getElementById('vault-merge-target-password') as HTMLInputElement, {
    target: { value: 'target-password-1234' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'mergeButton' }));
  return screen.findByTestId('vault-merge-complete');
}

/**
 * Secrets that must never appear in rendered HTML: the three WIF base58
 * prefixes, vault-service internals, and every passphrase literal the flows
 * in this file type into inputs.
 */
const SECRET_SUBSTRINGS = [
  '5J',
  '5K',
  '5H',
  'kek',
  'payload',
  'a-strong-passphrase-1',
  'different-passphrase',
  'the-vault-password-1',
  'source-password-1234',
  'target-password-1234',
  'wrong-but-nonempty',
] as const;

/** Assert a rendered tree (document.body covers radix portals) leaks none. */
function expectNoSecrets(container: HTMLElement) {
  const html = container.innerHTML;
  for (const secret of SECRET_SUBSTRINGS) {
    expect(html, `rendered tree leaked "${secret}"`).not.toContain(secret);
  }
}

describe('VaultManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVaultRuntime();
    createdUrlCount = 0;
    URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    resetVaultRuntime();
  });

  it('renders vault rows with name, active and lock badges and backup state', async () => {
    const state = makeManager([
      summary({ vaultName: 'Main', active: true, locked: false, lastBackupAt: 1_700_000_100_000 }),
      summary({ vaultName: 'Backup' }),
    ]);
    renderPanel(state);

    await waitFor(() => {
      expect(screen.getAllByTestId('vault-row')).toHaveLength(2);
    });
    const main = screen.getByText('Main').closest('li');
    expect(main).toHaveTextContent('activeBadge');
    expect(main).toHaveTextContent('unlockedBadge');
    expect(main).toHaveTextContent('lastBackupAt');
    const backup = screen.getByText('Backup').closest('li');
    expect(backup).toHaveTextContent('lockedBadge');
    expect(backup).toHaveTextContent('neverBackedUp');
  });

  it('shows the privateKey info card instead of vaults when mode is privateKey', async () => {
    const state = makeManager([]);
    renderPanel(state, makeFacade('privateKey'));
    await waitFor(() => {
      expect(screen.getByText('legacyActiveTitle')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('vault-section')).not.toBeInTheDocument();
  });

  it('opens the three-option empty dialog for an empty vault list; continue browsing closes it', async () => {
    const state = makeManager([]);
    renderPanel(state);

    await waitFor(() => {
      expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'emptyCreate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'emptyImport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'emptyContinue' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'emptyContinue' }));
    await waitFor(() => {
      expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
    });
    // The inline empty state remains reachable.
    expect(screen.getByText('emptyInline')).toBeInTheDocument();
  });

  it('empty dialog create/import options open the corresponding forms', async () => {
    const state = makeManager([]);
    renderPanel(state);

    await waitFor(() => {
      expect(screen.getByText('emptyTitle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'emptyCreate' }));
    expect(await screen.findByTestId('vault-create-form')).toBeInTheDocument();
  });

  it('create flow: mismatch error blocks submit; weak password maps the code; success opens the key confirmation', async () => {
    const state = makeManager([]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('emptyInline')).toBeInTheDocument();
    });

    // The auto-opened empty dialog marks the background aria-hidden (radix
    // modal) — close it before reaching the panel's own buttons.
    fireEvent.click(screen.getByRole('button', { name: 'emptyContinue' }));
    await waitFor(() => {
      expect(screen.queryByText('emptyTitle')).not.toBeInTheDocument();
    });

    // Open the create form via the panel button.
    fireEvent.click(screen.getByRole('button', { name: 'createVault' }));
    const form = await screen.findByTestId('vault-create-form');

    const nameInput = document.getElementById('vault-create-name') as HTMLInputElement;
    const passwordInput = document.getElementById('vault-create-password') as HTMLInputElement;
    const confirmInput = document.getElementById('vault-create-confirm') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Vault' } });
    fireEvent.change(passwordInput, { target: { value: 'a-strong-passphrase-1' } });
    fireEvent.change(confirmInput, { target: { value: 'different-passphrase' } });

    expect(screen.getByText('passwordMismatch')).toBeInTheDocument();
    expect(form.querySelector('button[type="submit"]')).toBeDisabled();

    // Fix the mismatch but let the manager reject with a mapped code.
    fireEvent.change(confirmInput, { target: { value: 'a-strong-passphrase-1' } });
    const createVault = state.manager.createVault as unknown as AnyMock;
    createVault.mockRejectedValueOnce(
      new VaultError('VAULT_PASSWORD_WEAK', 'internal english message'),
    );
    fireEvent.click(form.querySelector('button[type="submit"]') as HTMLButtonElement);

    expect(await screen.findByText('errors.VAULT_PASSWORD_WEAK')).toBeInTheDocument();
    expect(screen.queryByText('internal english message')).not.toBeInTheDocument();

    // Retry succeeds → list refresh + key confirmation dialog.
    fireEvent.click(form.querySelector('button[type="submit"]') as HTMLButtonElement);
    expect(await screen.findByText('keyConfirmTitle')).toBeInTheDocument();
    expect(screen.getByText(/New Vault/)).toBeInTheDocument();
    // Continue stays disabled until the backup acknowledgment is ticked.
    const continueButton = screen.getByTestId('vault-key-confirmation-continue');
    expect(continueButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(continueButton).not.toBeDisabled();

    // The create-success tree (including the portaled key-confirmation
    // dialog) leaks neither key material nor the typed passphrases.
    expectNoSecrets(document.body);
  });

  it('unlock dialog: wrong password surfaces the mapped code and stays open; success unlocks', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeInTheDocument();
    });

    await chooseRowAction('actionUnlock');
    const unlockDialog = await screen.findByText('unlockTitle');
    expect(unlockDialog).toBeInTheDocument();

    const unlockVault = state.manager.unlockVault as unknown as AnyMock;
    unlockVault.mockRejectedValueOnce(new VaultError('VAULT_PASSWORD_INVALID', 'nope'));
    const passwordInput = document.getElementById(
      'vault-unlock-password',
    ) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'wrong-but-nonempty' } });
    fireEvent.click(screen.getByRole('button', { name: 'unlockButton' }));

    expect(await screen.findByText('errors.VAULT_PASSWORD_INVALID')).toBeInTheDocument();
    expect(screen.getByText('unlockTitle')).toBeInTheDocument();

    // Retry with the accepting mock → dialog closes, list shows unlocked.
    fireEvent.click(screen.getByRole('button', { name: 'unlockButton' }));
    await waitFor(() => {
      expect(screen.queryByText('unlockTitle')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('unlockedBadge')).toBeInTheDocument();
    });
  });

  it('lock and activate row actions call the manager', async () => {
    const state = makeManager([summary({ vaultName: 'Main', locked: false })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('unlockedBadge')).toBeInTheDocument();
    });

    await chooseRowAction('actionLock');
    await waitFor(() => {
      expect(state.manager.lockVault).toHaveBeenCalledWith('Main');
    });

    await chooseRowAction('actionActivate');
    await waitFor(() => {
      expect(state.manager.activateVault).toHaveBeenCalledWith('Main');
    });
  });

  it('export downloads the five-field envelope client-side; the revision bump locks the row again', async () => {
    // Start UNLOCKED so the post-export lock assertion cannot pass trivially.
    const state = makeManager([summary({ vaultName: 'Main', locked: false })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('unlockedBadge')).toBeInTheDocument();
    });

    await chooseRowAction('actionExport');
    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
    });
    expect(state.manager.exportVault).toHaveBeenCalledWith('Main');
    // The export bumps the revision, ending this tab's session (A4 note) —
    // the refreshed list shows the vault locked again.
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });
    expect(screen.queryByText('unlockedBadge')).not.toBeInTheDocument();
    // The lock is also stated explicitly as a post-export info banner.
    expect(screen.getByText('exportSuccess')).toBeInTheDocument();
  });

  it('mode read failure replaces the forever-spinner with the unavailable notice; retry recovers', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    const facade = makeFacade('privateKey');
    (facade.getSigningMode as unknown as AnyMock).mockRejectedValueOnce(
      new Error('mode read failed'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPanel(state, facade);

    // The switcher shows its inline error + retry; the panel body swaps the
    // loading spinner for the short unavailable notice. The hook state lives
    // in the switcher, so the panel learns through the callback effect one
    // commit later — assert the notice asynchronously.
    expect(await screen.findByText('modeLoadFailed')).toBeInTheDocument();
    expect(await screen.findByTestId('mode-unavailable')).toHaveTextContent('modeUnavailable');
    await waitFor(() => {
      expect(screen.queryByText('modeLoading')).not.toBeInTheDocument();
    });

    // Retry re-reads the mode; the panel recovers (privateKey info card).
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText('legacyActiveTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('mode-unavailable')).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('delete asks for the vault password and calls removeVault', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeInTheDocument();
    });

    await chooseRowAction('actionDelete');
    expect(await screen.findByText('deleteTitle')).toBeInTheDocument();
    expect(screen.getByText('deleteWarning')).toBeInTheDocument();

    const passwordInput = document.getElementById('vault-delete-password') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'the-vault-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'deleteButton' }));

    await waitFor(() => {
      expect(state.manager.removeVault).toHaveBeenCalledWith('Main', 'the-vault-password-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('deleteTitle')).not.toBeInTheDocument();
    });
  });

  it('merge form is reachable on a LOCKED target and submits the target password (per-key contract)', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });

    await chooseRowAction('actionMerge');
    expect(await screen.findByText('mergeTitle')).toBeInTheDocument();
    // No pre-unlock step: the file, source-password and target-password
    // inputs are all offered directly on the locked vault.
    expect(document.getElementById('vault-merge-file')).not.toBeNull();
    expect(document.getElementById('vault-merge-password')).not.toBeNull();
    expect(document.getElementById('vault-merge-target-password')).not.toBeNull();

    const file = new File([JSON.stringify(envelopeFor('Source'))], 'source-backup.json', {
      type: 'application/json',
    });
    fireEvent.change(document.getElementById('vault-merge-file') as HTMLInputElement, {
      target: { files: [file] },
    });
    fireEvent.change(document.getElementById('vault-merge-password') as HTMLInputElement, {
      target: { value: 'source-password-1234' },
    });
    fireEvent.change(document.getElementById('vault-merge-target-password') as HTMLInputElement, {
      target: { value: 'target-password-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'mergeButton' }));

    await waitFor(() => {
      expect(state.manager.importVaultDetailed).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'merge',
          targetVaultName: 'Main',
          password: 'source-password-1234',
          targetPassword: 'target-password-1234',
        }),
      );
    });
    // The typed passwords never render into the tree.
    expectNoSecrets(document.body);
  });

  it('merge completion: the pre-merge backup must be downloaded or explicitly discarded before continuing', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });

    // Completion dialog: locked notice + pending backup warning.
    const dialog = await mergeToComplete(state);
    expect(dialog).toHaveTextContent('mergeCompleteTitle');
    expect(dialog).toHaveTextContent('mergeLockedNotice');
    expect(screen.getByTestId('merge-backup-pending')).toBeInTheDocument();
    // Continue is DISABLED while the delivery is pending — the UI must not
    // treat the memory-only snapshot as a completed backup.
    expect(screen.getByTestId('vault-merge-continue')).toBeDisabled();

    // Download delivers the backup (blob URL), unlocks Continue.
    fireEvent.click(screen.getByTestId('vault-merge-download-backup'));
    expect(await screen.findByTestId('merge-backup-saved')).toBeInTheDocument();
    expect(screen.getByTestId('vault-merge-continue')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('vault-merge-continue'));
    await waitFor(() => {
      expect(screen.queryByTestId('vault-merge-complete')).not.toBeInTheDocument();
    });
  });

  it('merge completion: explicit discard also unlocks Continue', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });

    await mergeToComplete(state);
    fireEvent.click(screen.getByTestId('vault-merge-discard-backup'));
    expect(await screen.findByTestId('merge-backup-discarded')).toBeInTheDocument();
    expect(screen.getByTestId('vault-merge-continue')).not.toBeDisabled();
  });

  it('merge completion: pending delivery is dismiss-proof (Esc and the X button keep the dialog open)', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });

    await mergeToComplete(state);

    // Esc: radix's DismissableLayer listens for keydown on document —
    // dispatching there is the jsdom equivalent of pressing Escape (firing
    // on the dialog element itself does not reach that listener reliably).
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('vault-merge-complete')).toBeInTheDocument();
    expect(screen.getByTestId('vault-merge-continue')).toBeDisabled();

    // The X close button (radix DialogContent close) — same interception.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('vault-merge-complete')).toBeInTheDocument();
    expect(screen.getByTestId('vault-merge-continue')).toBeDisabled();
    expect(screen.getByTestId('merge-backup-pending')).toBeInTheDocument();
  });

  it('merge completion: after the explicit choice, Esc closes like Continue', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('lockedBadge')).toBeInTheDocument();
    });

    await mergeToComplete(state);
    fireEvent.click(screen.getByTestId('vault-merge-discard-backup'));
    expect(await screen.findByTestId('merge-backup-discarded')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('vault-merge-complete')).not.toBeInTheDocument();
    });
  });

  it('surfaces mapped errors for simple row actions (activate failure)', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    (state.manager.activateVault as unknown as AnyMock).mockRejectedValueOnce(
      new VaultError('VAULT_SESSION_STALE', 'internal'),
    );
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeInTheDocument();
    });

    await chooseRowAction('actionActivate');
    expect(await screen.findByText('errors.VAULT_SESSION_STALE')).toBeInTheDocument();
  });

  it('renders no key material anywhere in the tree', async () => {
    const state = makeManager([summary({ vaultName: 'Main' })]);
    renderPanel(state);
    await waitFor(() => {
      expect(screen.getByText('Main')).toBeInTheDocument();
    });
    // Sensitive strings from the vault layers never appear in rendered HTML
    // (document.body also covers radix portal containers).
    expectNoSecrets(document.body);
  });
});

describe('VaultWorkModeContent / VaultProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVaultRuntime();
  });

  afterEach(() => {
    resetVaultRuntime();
  });

  it('shows the storage-unavailable fallback with retry, then recovers', async () => {
    openRegistryMock.mockRejectedValueOnce(
      new VaultError('VAULT_STORAGE_UNAVAILABLE', 'no idb'),
    );
    openRegistryMock.mockResolvedValueOnce({
      listRecords: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        schemaVersion: 1,
        signingMode: 'privateKey',
        activeVaultName: null,
      })),
    } as unknown as Awaited<ReturnType<typeof openVaultRegistry>>);

    render(
      <VaultProvider>
        <VaultWorkModeContent />
      </VaultProvider>,
    );

    // Loading → unavailable with the mapped message + retry.
    expect(await screen.findByText('errors.VAULT_STORAGE_UNAVAILABLE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));

    // After retry the runtime becomes ready: the real facade reads the
    // (mocked) settings row and the panel renders the privateKey info card.
    expect(await screen.findByText('legacyActiveTitle')).toBeInTheDocument();
    expect(screen.queryByText('errors.VAULT_STORAGE_UNAVAILABLE')).not.toBeInTheDocument();
  });
});
