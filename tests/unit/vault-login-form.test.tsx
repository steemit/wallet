/**
 * VaultLoginForm (R3) — no-unlock identity selection, jsdom coverage with a
 * mocked vault runtime (no IndexedDB, no crypto, no network).
 *
 * Focus areas from the R3 acceptance (handoff §5 step 4):
 *  - two NATIVE selects fed by the public directory: vault list -> the
 *    selected vault's outer `accounts` (account names only);
 *  - default = the ACTIVE vault, else the first;
 *  - switching the vault clears the account selection, and a SLOW directory
 *    response for a previously selected vault never overwrites the new one;
 *  - three empty/error states: no vault (create/import entry -> Work Mode
 *    event), empty vault (add-a-key hint -> Work Mode event), storage error
 *    (mapped `vault.errors.*` + Retry) — never the PrivateKey form;
 *  - submit dispatches setVaultIdentity: sessionKind 'vault', every key field
 *    null; NO unlock, NO challenge/login call, NO fetch at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { VaultError } from '@/lib/vault/errors';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultAccountSummary, VaultSummary } from '@/lib/vault/types';
import type { VaultRuntime } from '@/components/vault/vault-manager';
import {
  VAULT_WORK_MODE_CLOSED_EVENT,
  VAULT_WORK_MODE_OPEN_EVENT,
} from '@/components/vault/work-mode-events';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// The runtime the form consumes; each test installs its own.
let mockRuntime: VaultRuntime = { state: 'loading' };
vi.mock('@/components/vault/vault-manager', () => ({
  useVaultRuntime: () => mockRuntime,
}));

// The form must never reach the auth endpoints — spies prove it.
const mockGetChallenge = vi.fn();
const mockLogin = vi.fn();
const mockGetAccounts = vi.fn();
vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getChallenge: (...args: unknown[]) => mockGetChallenge(...args),
    login: (...args: unknown[]) => mockLogin(...args),
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
  },
  SteemSigner: {},
}));

import { VaultLoginForm } from '@/components/auth/vault-login-form';

function vaultSummary(vaultName: string, active = false): VaultSummary {
  return {
    vaultName,
    active,
    locked: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastBackupAt: null,
  };
}

function account(accountName: string, iv: string, note: string): VaultAccountSummary {
  return { accountName, keys: [{ role: 'posting', iv, note }], balances: null };
}

/** Public directories per vault (IVs/notes present — they must not render). */
const DIRECTORIES: Record<string, VaultAccountSummary[]> = {
  Personal: [account('alice', 'IV_ALICE_POSTING_0001', 'NOTE_ALICE_DESKTOP')],
  Work: [
    account('bob', 'IV_BOB_POSTING_000002', 'NOTE_BOB_LAPTOP'),
    account('carol', 'IV_CAROL_POSTING_0003', 'NOTE_CAROL_PHONE'),
  ],
  Empty: [],
};

function makeManager(
  vaults: VaultSummary[],
  directories: Record<string, VaultAccountSummary[]> = DIRECTORIES,
): VaultManagerExtended {
  return {
    listVaults: vi.fn(async () => vaults.map((vault) => ({ ...vault }))),
    getAccounts: vi.fn(async (vaultName?: string) =>
      (directories[vaultName ?? ''] ?? []).map((entry) => ({ ...entry })),
    ),
    unlockVault: vi.fn(),
    addKey: vi.fn(),
    removeKey: vi.fn(),
    updateKeyNote: vi.fn(),
    createSigner: vi.fn(),
  } as unknown as VaultManagerExtended;
}

function ready(manager: VaultManagerExtended): VaultRuntime {
  return { state: 'ready', manager, facade: {} as never };
}

function renderForm(props: Parameters<typeof VaultLoginForm>[0] = {}) {
  const store = configureStore({ reducer: { auth: authReducer } });
  const utils = render(
    <Provider store={store}>
      <VaultLoginForm {...props} />
    </Provider>,
  );
  return { store, ...utils };
}

const vaultSelect = () => screen.getByTestId('vault-login-vault-select') as HTMLSelectElement;
const accountSelect = () => screen.getByTestId('vault-login-account-select') as HTMLSelectElement;
const optionValues = (select: HTMLSelectElement) =>
  Array.from(select.options).map((option) => option.value);

/** A promise the test resolves by hand (slow-response simulation). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('VaultLoginForm (R3 identity selection without unlocking)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = { state: 'loading' };
    fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists every vault, defaults to the ACTIVE one and loads its public account directory', async () => {
    const manager = makeManager([vaultSummary('Personal'), vaultSummary('Work', true)]);
    mockRuntime = ready(manager);
    renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    expect(optionValues(vaultSelect())).toEqual(['Personal', 'Work']);
    expect(vaultSelect().value).toBe('Work');
    // Placeholder selected: nothing chosen yet, submit disabled.
    expect(accountSelect().value).toBe('');
    expect(screen.getByTestId('vault-login-submit')).toBeDisabled();
    expect(manager.getAccounts).toHaveBeenCalledWith('Work');
    // Locked-readable directory: no password, no unlock.
    expect(manager.unlockVault).not.toHaveBeenCalled();
  });

  it('without an active vault the first vault is selected', async () => {
    const manager = makeManager([vaultSummary('Personal'), vaultSummary('Work')]);
    mockRuntime = ready(manager);
    renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });
    expect(vaultSelect().value).toBe('Personal');
  });

  it('switching the vault clears the account selection and loads the new directory', async () => {
    const manager = makeManager([vaultSummary('Personal'), vaultSummary('Work', true)]);
    mockRuntime = ready(manager);
    renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    fireEvent.change(accountSelect(), { target: { value: 'carol' } });
    expect(accountSelect().value).toBe('carol');
    expect(screen.getByTestId('vault-login-submit')).not.toBeDisabled();

    fireEvent.change(vaultSelect(), { target: { value: 'Personal' } });
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });
    expect(accountSelect().value).toBe('');
    expect(screen.getByTestId('vault-login-submit')).toBeDisabled();

    // Switching BACK does not resurrect the old choice either.
    fireEvent.change(vaultSelect(), { target: { value: 'Work' } });
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    expect(accountSelect().value).toBe('');
  });

  it('a slow directory response for a previously selected vault never overwrites the new selection', async () => {
    const slowWork = deferred<VaultAccountSummary[]>();
    const manager = makeManager([vaultSummary('Personal'), vaultSummary('Work', true)]);
    (manager.getAccounts as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (vaultName?: string) => {
        if (vaultName === 'Work') return slowWork.promise;
        return (DIRECTORIES[vaultName ?? ''] ?? []).map((entry) => ({ ...entry }));
      },
    );
    mockRuntime = ready(manager);
    renderForm();

    // Default (active) Work is loading; the vault select stays usable.
    await waitFor(() => {
      expect(vaultSelect().value).toBe('Work');
    });
    expect(screen.getByTestId('vault-login-loading')).toHaveTextContent('vaultAccountsLoading');

    fireEvent.change(vaultSelect(), { target: { value: 'Personal' } });
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });

    // The stale Work response lands late — it must be discarded.
    await act(async () => {
      slowWork.resolve(DIRECTORIES.Work ?? []);
      await slowWork.promise;
    });
    expect(vaultSelect().value).toBe('Personal');
    expect(optionValues(accountSelect())).toEqual(['', 'alice']);
  });

  it('no vault: shows the create/import entry that opens the Work Mode modal', async () => {
    mockRuntime = ready(makeManager([]));
    const onOpen = vi.fn();
    window.addEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
    renderForm();

    const empty = await screen.findByTestId('vault-login-no-vaults');
    expect(empty).toHaveTextContent('vaultNoVaultsTitle');
    expect(screen.queryByTestId('vault-login-vault-select')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'vaultOpenManager' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
  });

  it('empty vault: prompts to add a private key first (Work Mode entry), no submit', async () => {
    mockRuntime = ready(makeManager([vaultSummary('Empty', true), vaultSummary('Work')]));
    const onOpen = vi.fn();
    window.addEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
    renderForm();

    const empty = await screen.findByTestId('vault-login-empty-vault');
    expect(empty).toHaveTextContent('vaultEmptyTitle');
    expect(screen.queryByTestId('vault-login-submit')).not.toBeInTheDocument();
    // The vault select stays available to pick another vault.
    expect(vaultSelect().value).toBe('Empty');

    fireEvent.click(screen.getByRole('button', { name: 'vaultManageKeys' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);

    fireEvent.change(vaultSelect(), { target: { value: 'Work' } });
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
  });

  it('accounts holding no key are not offered; a vault of only keyless accounts reads as empty', async () => {
    const keyless = (accountName: string): VaultAccountSummary => ({
      accountName,
      keys: [],
      balances: null,
    });
    const manager = makeManager([vaultSummary('Mixed', true), vaultSummary('Hollow')], {
      Mixed: [keyless('dave'), account('erin', 'IV_ERIN_POSTING_00004', 'NOTE_ERIN')],
      Hollow: [keyless('frank')],
    });
    mockRuntime = ready(manager);
    renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'erin']);
    });

    fireEvent.change(vaultSelect(), { target: { value: 'Hollow' } });
    expect(await screen.findByTestId('vault-login-empty-vault')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-submit')).not.toBeInTheDocument();
  });

  it('storage error on the vault list: mapped code + Retry, never the PrivateKey form', async () => {
    const manager = makeManager([vaultSummary('Work', true)]);
    (manager.listVaults as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new VaultError('VAULT_STORAGE_UNAVAILABLE', 'internal detail'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuntime = ready(manager);
    renderForm();

    expect(await screen.findByText('errors.VAULT_STORAGE_UNAVAILABLE')).toBeInTheDocument();
    // No silent fallback: no username / private-key inputs anywhere.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByText('privateKey')).not.toBeInTheDocument();
    expect(screen.queryByText('internal detail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    expect(screen.queryByText('errors.VAULT_STORAGE_UNAVAILABLE')).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('unexpected (non-vault) errors map to the generic message', async () => {
    const manager = makeManager([vaultSummary('Work', true)]);
    (manager.listVaults as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuntime = ready(manager);
    renderForm();

    expect(await screen.findByText('errors.unexpected')).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('directory load error: mapped code + Retry reloads the selected vault', async () => {
    const manager = makeManager([vaultSummary('Work', true)]);
    (manager.getAccounts as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new VaultError('VAULT_NOT_FOUND', 'internal detail'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuntime = ready(manager);
    renderForm();

    expect(await screen.findByText('errors.VAULT_NOT_FOUND')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    expect(manager.getAccounts).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('vault runtime unavailable: mapped code + the runtime Retry', async () => {
    const retry = vi.fn();
    mockRuntime = { state: 'unavailable', code: 'VAULT_STORAGE_UNAVAILABLE', retry };
    renderForm();

    expect(screen.getByText('errors.VAULT_STORAGE_UNAVAILABLE')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('submit records the vault identity (sessionKind vault, no key material) with no unlock and no network', async () => {
    const manager = makeManager([vaultSummary('Personal'), vaultSummary('Work', true)]);
    mockRuntime = ready(manager);
    const { store } = renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    fireEvent.change(accountSelect(), { target: { value: 'carol' } });
    fireEvent.click(screen.getByTestId('vault-login-submit'));

    const auth = store.getState().auth;
    expect(auth.username).toBe('carol');
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.sessionKind).toBe('vault');
    for (const field of [
      'ownerKey',
      'activeKey',
      'postingKey',
      'memoKey',
      'privateKey',
      'publicKey',
    ] as const) {
      expect(auth[field], `${field} must stay null`).toBeNull();
    }
    expect(mockPush).toHaveBeenCalledWith('/@carol/transfers');

    // No unlock, no decryption entry point, no server authentication.
    expect(manager.unlockVault).not.toHaveBeenCalled();
    expect(mockGetChallenge).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockGetAccounts).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('embedded: submit calls onLoginSuccess instead of navigating', async () => {
    mockRuntime = ready(makeManager([vaultSummary('Personal', true)]));
    const onLoginSuccess = vi.fn();
    const { store } = renderForm({ embedded: true, onLoginSuccess });

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });
    fireEvent.change(accountSelect(), { target: { value: 'alice' } });
    fireEvent.click(screen.getByTestId('vault-login-submit'));

    expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(store.getState().auth.sessionKind).toBe('vault');
  });

  it('renders account names only — no IVs, no notes, no key material', async () => {
    mockRuntime = ready(makeManager([vaultSummary('Personal'), vaultSummary('Work', true)]));
    renderForm();

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    const html = document.body.innerHTML;
    for (const forbidden of [
      'IV_BOB_POSTING_000002',
      'IV_CAROL_POSTING_0003',
      'NOTE_BOB_LAPTOP',
      'NOTE_CAROL_PHONE',
      '5J',
      '5K',
      '5H',
    ]) {
      expect(html, `rendered tree leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });

  // -------------------------------------------------------------------------
  // Directory-change refresh (Work Mode modal closed / tab visible again)
  // -------------------------------------------------------------------------

  /** A manager whose list + directories the test mutates between reads. */
  function makeMutableManager(initial: {
    vaults: VaultSummary[];
    directories: Record<string, VaultAccountSummary[]>;
  }) {
    const data = { ...initial };
    const manager = {
      listVaults: vi.fn(async () => data.vaults.map((vault) => ({ ...vault }))),
      getAccounts: vi.fn(async (vaultName?: string) =>
        (data.directories[vaultName ?? ''] ?? []).map((entry) => ({ ...entry })),
      ),
      unlockVault: vi.fn(),
    } as unknown as VaultManagerExtended;
    return { data, manager };
  }

  it('no vault -> a vault created in the Work Mode modal appears when the modal closes', async () => {
    const { data, manager } = makeMutableManager({ vaults: [], directories: {} });
    mockRuntime = ready(manager);
    renderForm();
    await screen.findByTestId('vault-login-no-vaults');

    // Created + a key added inside the modal, then the modal closes.
    data.vaults = [vaultSummary('Fresh', true)];
    data.directories = { Fresh: [account('alice', 'IV_ALICE_POSTING_0001', 'NOTE_A')] };
    act(() => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
    });

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });
    expect(vaultSelect().value).toBe('Fresh');
    expect(screen.queryByTestId('vault-login-no-vaults')).not.toBeInTheDocument();
  });

  it('empty vault -> keys added in the modal show up after it closes', async () => {
    const { data, manager } = makeMutableManager({
      vaults: [vaultSummary('Main', true)],
      directories: { Main: [] },
    });
    mockRuntime = ready(manager);
    renderForm();
    await screen.findByTestId('vault-login-empty-vault');

    data.directories = { Main: [account('bob', 'IV_BOB_POSTING_000002', 'NOTE_B')] };
    act(() => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
    });

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob']);
    });
  });

  it('a refresh is stale-while-revalidate and keeps a still-valid account choice', async () => {
    const { data, manager } = makeMutableManager({
      vaults: [vaultSummary('Work', true)],
      directories: { Work: DIRECTORIES.Work ?? [] },
    });
    mockRuntime = ready(manager);
    renderForm();
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    fireEvent.change(accountSelect(), { target: { value: 'carol' } });

    // Hold the re-read in flight: the current selects must stay usable.
    const slow = deferred<VaultAccountSummary[]>();
    (manager.getAccounts as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => slow.promise,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
    });
    await waitFor(() => {
      expect(manager.getAccounts).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId('vault-login-loading')).not.toBeInTheDocument();
    expect(accountSelect().value).toBe('carol');

    // The re-read lands with a new account; carol still exists -> kept.
    data.directories = {
      Work: [...(DIRECTORIES.Work ?? []), account('dave', 'IV_DAVE_POSTING_00005', 'NOTE_D')],
    };
    await act(async () => {
      slow.resolve(data.directories.Work ?? []);
      await slow.promise;
    });
    expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol', 'dave']);
    expect(accountSelect().value).toBe('carol');
  });

  it('a removed account drops the stale choice after a refresh', async () => {
    const { data, manager } = makeMutableManager({
      vaults: [vaultSummary('Work', true)],
      directories: { Work: DIRECTORIES.Work ?? [] },
    });
    mockRuntime = ready(manager);
    renderForm();
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob', 'carol']);
    });
    fireEvent.change(accountSelect(), { target: { value: 'carol' } });

    data.directories = {
      Work: (DIRECTORIES.Work ?? []).filter((entry) => entry.accountName !== 'carol'),
    };
    act(() => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
    });
    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'bob']);
    });
    expect(accountSelect().value).toBe('');
    expect(screen.getByTestId('vault-login-submit')).toBeDisabled();
  });

  it('changes made in another tab are picked up when this tab becomes visible again', async () => {
    const { data, manager } = makeMutableManager({ vaults: [], directories: {} });
    mockRuntime = ready(manager);
    renderForm();
    await screen.findByTestId('vault-login-no-vaults');

    data.vaults = [vaultSummary('Other', true)];
    data.directories = { Other: [account('alice', 'IV_ALICE_POSTING_0001', 'NOTE_A')] };
    // jsdom reports visibilityState 'visible'.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(optionValues(accountSelect())).toEqual(['', 'alice']);
    });
  });
});
