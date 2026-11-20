/**
 * Unified consumer signing entry (A6-T2) — the routing matrix and the vault
 * password dialog behavior.
 *
 * Routing (session kind, not persisted mode — see the hook header):
 *   - privateKey session with a key  -> the hook module's STATIC legacy
 *     signer (round-1 review P2: privateKey signing is INDEPENDENT of the
 *     vault runtime — it works while the runtime is loading AND when storage
 *     is unavailable), NO dialog, role = the LOWEST session key at-or-above
 *     the floor;
 *   - privateKey session without key -> `needsClassicReauth` (no sign call);
 *   - vault session                  -> VaultSigningDialog over the runtime's
 *     vaultSigner: candidates from the locked-readable directory, one-shot
 *     password, mapped `vault.errors.*` surfaces, cancel = typed cancel.
 *
 * Injection seams: `useVaultRuntime` is mocked (the login-form dispatch
 * pattern — only the DIALOG consumes the runtime now) and the privateKey
 * backend is observed by mocking the `createLegacyPrivateKeySigner` factory
 * the hook builds its static instance from; the dialog itself is the REAL
 * component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, {
  setVaultIdentity,
  type AuthState,
} from '@/lib/store/slices/auth';
import type { VaultRuntime } from '@/components/vault/vault-manager';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultSigner } from '@/lib/vault/types';
import { VaultError } from '@/lib/vault/errors';
import {
  useSessionSigning,
  resolveSessionSigningRole,
  type SessionSignOutcome,
} from '@/hooks/use-session-signing';
import { VAULT_WORK_MODE_OPEN_EVENT } from '@/components/vault/work-mode-events';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

let mockRuntime: VaultRuntime = { state: 'loading' };
vi.mock('@/components/vault/vault-manager', () => ({
  useVaultRuntime: () => mockRuntime,
}));

// The hook's STATIC privateKey backend is built at hook-module load from
// this factory — mocking the factory swaps the singleton for an observable
// spy-backed signer (the module-level instance pattern itself is pinned by
// the runtime-state tests: signing must succeed with the runtime NOT ready).
const statics = vi.hoisted(() => ({
  legacySigner: {
    signOperations: vi.fn(),
    signResolvedTransaction: vi.fn(),
  } satisfies Partial<VaultSigner>,
}));
vi.mock('@/lib/auth/legacy-private-key-signer', () => ({
  createLegacyPrivateKeySigner: () => statics.legacySigner,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const OPERATIONS = [
  ['transfer', { from: 'alice', to: 'bob', amount: '1.000 STEEM', memo: '' }],
] as unknown as import('@/lib/steem/types').Operation[];

const REQUEST = {
  operations: OPERATIONS,
  accountName: 'alice',
  role: 'active',
} as const;

function privateKeyAuth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    username: 'alice',
    ownerKey: null,
    activeKey: '5J-test-active',
    postingKey: null,
    memoKey: null,
    privateKey: '5J-test-active',
    publicKey: 'STM-test',
    isAuthenticated: true,
    sessionKind: 'privateKey',
    ...overrides,
  };
}

function vaultAuth(): AuthState {
  return {
    ...privateKeyAuth(),
    ownerKey: null,
    activeKey: null,
    postingKey: null,
    memoKey: null,
    privateKey: null,
    publicKey: null,
    sessionKind: 'vault',
  };
}

function makeStore(auth: AuthState) {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth },
  });
  // Drive the slice the way VaultLoginForm does (verifies the hook really
  // reads the derived session kind, not a hand-built state literal).
  if (auth.sessionKind === 'vault') {
    store.dispatch(setVaultIdentity({ username: 'alice' }));
  }
  return store;
}

const SIGNED_TX = {
  ref_block_num: 1,
  ref_block_prefix: 2,
  expiration: '2026-11-21T00:00:00',
  operations: [],
  extensions: [],
  signatures: ['sig'],
} as unknown as import('@/lib/steem/types').SignedTransaction;

const signResult = (
  overrides: Partial<import('@/lib/vault/types').SignResult> = {},
): import('@/lib/vault/types').SignResult => ({
  signedTx: SIGNED_TX,
  transactionId: 'txid',
  accountName: 'alice',
  role: 'active',
  publicKey: 'STM8pub',
  locked: true,
  ...overrides,
});

function makeSigner(): VaultSigner {
  return {
    signOperations: vi.fn(),
    signResolvedTransaction: vi.fn(),
  } as unknown as VaultSigner;
}

function readyRuntime(manager: Partial<VaultManagerExtended>): {
  vaultSigner: VaultSigner;
  legacySigner: VaultSigner;
} {
  const vaultSigner = makeSigner();
  const legacySigner = makeSigner();
  mockRuntime = {
    state: 'ready',
    manager: manager as VaultManagerExtended,
    facade: {} as never,
    vaultSigner,
    legacySigner,
  };
  return { vaultSigner, legacySigner };
}

/** Directory fixture: alice holds one active key + one posting key. */
function directoryFixture() {
  return [
    {
      accountName: 'alice',
      balances: null,
      keys: [
        {
          role: 'active',
          iv: 'iv-active-1',
          note: 'hardware active key',
          publicKey: 'STM8ActiveKeyAAAA',
        },
        {
          role: 'posting',
          iv: 'iv-posting-1',
          note: 'posting key',
          publicKey: 'STM8PostingKeyAAA',
        },
      ],
    },
    {
      accountName: 'bob',
      balances: null,
      keys: [
        { role: 'owner', iv: 'iv-bob-owner', note: '', publicKey: null },
      ],
    },
  ];
}

let outcomes: SessionSignOutcome[];

function Harness() {
  const signing = useSessionSigning();
  return (
    <div>
      <button
        type="button"
        data-testid="harness-start"
        // Concurrent-start probe: a second click while one request is
        // pending exercises the single in-flight guard.
        onClick={() => {
          void signing.sign({ ...REQUEST }).then((outcome) => outcomes.push(outcome));
        }}
      >
        start
      </button>
      <button
        type="button"
        data-testid="harness-start-mismatch"
        // Identity-mismatch probe (round-1 review defense-in-depth): a
        // request whose accountName is NOT the session identity.
        onClick={() => {
          void signing
            .sign({ ...REQUEST, accountName: 'bob' })
            .then((outcome) => outcomes.push(outcome));
        }}
      >
        start mismatch
      </button>
      {signing.dialog}
    </div>
  );
}

function renderHarness(auth: AuthState) {
  return render(
    <Provider store={makeStore(auth)}>
      <Harness />
    </Provider>,
  );
}

// TestId (not role): the open dialog aria-hides outside content, so
// role queries cannot reach the harness button while it is open.
const startSign = () => fireEvent.click(screen.getByTestId('harness-start'));
const passwordInput = () => screen.getByLabelText('signDialogPasswordLabel');

async function submitDialog() {
  fireEvent.click(screen.getByTestId('vault-signing-submit'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRuntime = { state: 'loading' };
  outcomes = [];
});

describe('resolveSessionSigningRole (lowest key at-or-above the floor)', () => {
  it('prefers the lowest matching key, falling back upward', () => {
    expect(
      resolveSessionSigningRole({ ownerKey: 'a', activeKey: 'b', postingKey: 'c' }, 'active'),
    ).toBe('active');
    expect(
      resolveSessionSigningRole({ ownerKey: 'a', activeKey: null, postingKey: 'c' }, 'active'),
    ).toBe('owner');
    expect(
      resolveSessionSigningRole({ ownerKey: null, activeKey: null, postingKey: 'c' }, 'active'),
    ).toBeNull();
    // A posting floor accepts any signing key (posting -> active -> owner).
    expect(
      resolveSessionSigningRole({ ownerKey: null, activeKey: 'b', postingKey: null }, 'posting'),
    ).toBe('active');
  });
});

describe('useSessionSigning — privateKey sessions (dialogless)', () => {
  it('signs through the static legacy backend with the lowest session key, no dialog', async () => {
    readyRuntime({});
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValue(signResult({ locked: false }));
    renderHarness(privateKeyAuth());

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));

    expect(statics.legacySigner.signOperations).toHaveBeenCalledTimes(1);
    expect(statics.legacySigner.signOperations).toHaveBeenCalledWith({
      accountName: 'alice',
      role: 'active',
      keyIv: '',
      vaultPassword: '',
      operations: OPERATIONS,
    });
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
    // No dialog anywhere on the privateKey path.
    expect(screen.queryByTestId('vault-signing-dialog')).not.toBeInTheDocument();
  });

  it('falls back to the owner key when the session holds no active key', async () => {
    readyRuntime({});
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValue(signResult());
    renderHarness(privateKeyAuth({ activeKey: null, ownerKey: '5J-test-owner' }));

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(statics.legacySigner.signOperations).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner' }),
    );
  });

  it('resolves needsClassicReauth without a signing round-trip when no key is held', async () => {
    readyRuntime({});
    renderHarness(privateKeyAuth({ activeKey: null, ownerKey: null }));

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'needsClassicReauth' });
    expect(statics.legacySigner.signOperations).not.toHaveBeenCalled();
  });

  it('maps a legacy VAULT_KEY_INVALID to needsClassicReauth (the signer re-reads keys at signing time)', async () => {
    readyRuntime({});
    vi.mocked(statics.legacySigner.signOperations).mockRejectedValue(
      new VaultError('VAULT_KEY_INVALID', 'no private key is available'),
    );
    renderHarness(privateKeyAuth());

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'needsClassicReauth' });
  });

  it('surfaces other legacy signer errors as typed error codes', async () => {
    readyRuntime({});
    vi.mocked(statics.legacySigner.signOperations).mockRejectedValue(
      new VaultError('VAULT_CRYPTO_UNAVAILABLE', 'subtle missing'),
    );
    renderHarness(privateKeyAuth());

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'error', code: 'VAULT_CRYPTO_UNAVAILABLE' });
  });

  it('signs with the runtime still LOADING (round-1 P2: privateKey signing needs no vault runtime)', async () => {
    mockRuntime = { state: 'loading' };
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValue(signResult({ locked: false }));
    renderHarness(privateKeyAuth());

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
    expect(statics.legacySigner.signOperations).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('vault-signing-dialog')).not.toBeInTheDocument();
  });

  it('signs with the runtime UNAVAILABLE (storage-blocked environments keep signing)', async () => {
    mockRuntime = {
      state: 'unavailable',
      code: 'VAULT_STORAGE_UNAVAILABLE',
      retry: vi.fn(),
    };
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValue(signResult({ locked: false }));
    renderHarness(privateKeyAuth());

    startSign();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
    expect(statics.legacySigner.signOperations).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('vault-signing-dialog')).not.toBeInTheDocument();
  });

  it('the single in-flight guard covers the privateKey path too, then resets', async () => {
    readyRuntime({});
    // A pending (deferred) signing call holds the in-flight slot: a second
    // sign() resolves cancelled immediately, and the guard releases after
    // the first call settles so signing works again.
    let resolveFirst!: (value: ReturnType<typeof signResult>) => void;
    vi.mocked(statics.legacySigner.signOperations).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValueOnce(signResult());
    renderHarness(privateKeyAuth());

    startSign();
    startSign();
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
    expect(statics.legacySigner.signOperations).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(signResult());
    });
    await waitFor(() =>
      expect(outcomes[1]).toMatchObject({ status: 'signed' }),
    );

    startSign();
    await waitFor(() =>
      expect(outcomes[2]).toMatchObject({ status: 'signed' }),
    );
    // Two real signer calls: the deferred first attempt + the post-reset
    // third one; the guarded second attempt never reached the signer.
    expect(statics.legacySigner.signOperations).toHaveBeenCalledTimes(2);
  });
});

describe('useSessionSigning — vault sessions (dialog path)', () => {
  it('lists candidates from the locked directory, auto-selects the single one, signs with the password', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    vi.mocked(vaultSigner.signOperations).mockResolvedValue(signResult());
    renderHarness(vaultAuth());

    startSign();
    expect(await screen.findByTestId('vault-signing-dialog')).toBeInTheDocument();
    // The directory comes from the manager's no-argument locked read (the
    // same session -> active vault resolution the signer applies).
    await waitFor(() => expect(getAccounts).toHaveBeenCalledWith());
    // Role floor 'active' excludes alice's posting key: exactly one candidate
    // auto-selects with NO radio group.
    await waitFor(() => expect(screen.getByText('hardware active key')).toBeInTheDocument());
    expect(screen.queryByTestId('vault-signing-key-options')).not.toBeInTheDocument();

    fireEvent.change(passwordInput(), { target: { value: 'correct horse battery staple' } });
    await submitDialog();

    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(vaultSigner.signOperations).toHaveBeenCalledWith({
      accountName: 'alice',
      role: 'active',
      keyIv: 'iv-active-1',
      vaultPassword: 'correct horse battery staple',
      operations: OPERATIONS,
    });
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
    // The vault path never touches the privateKey backend.
    expect(statics.legacySigner.signOperations).not.toHaveBeenCalled();
    // Success closes the dialog.
    expect(screen.queryByTestId('vault-signing-dialog')).not.toBeInTheDocument();
  });

  it('wrong password stays in-dialog with the mapped error and a cleared field; retry signs', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    vi.mocked(vaultSigner.signOperations)
      .mockRejectedValueOnce(new VaultError('VAULT_PASSWORD_INVALID', 'bad'))
      .mockResolvedValueOnce(signResult());
    renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-dialog');
    fireEvent.change(passwordInput(), { target: { value: 'wrong-password' } });
    await submitDialog();

    // The dialog stays open with the mapped error + retry hint, and the
    // typed password is cleared.
    expect(await screen.findByText('errors.VAULT_PASSWORD_INVALID')).toBeInTheDocument();
    expect(screen.getByText('signDialogRetryHint')).toBeInTheDocument();
    expect((passwordInput() as HTMLInputElement).value).toBe('');
    expect(outcomes).toHaveLength(0);

    fireEvent.change(passwordInput(), { target: { value: 'correct-password' } });
    await submitDialog();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
    expect(vaultSigner.signOperations).toHaveBeenCalledTimes(2);
  });

  it('fails closed on a request for a DIFFERENT account than the session identity (no dialog, no signing)', async () => {
    // Round-1 review defense-in-depth: the identity assert lives in the
    // hook's vault branch — a mismatched accountName must never reach the
    // dialog (it would list that account's keys for this session).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    renderHarness(vaultAuth());

    fireEvent.click(screen.getByTestId('harness-start-mismatch'));
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'error', code: 'VAULT_KEY_INVALID' });
    expect(consoleError).toHaveBeenCalledWith(
      'Vault signing request account does not match the session identity',
      'bob',
    );
    // No dialog was ever offered; no directory read; neither backend signed.
    expect(screen.queryByTestId('vault-signing-dialog')).not.toBeInTheDocument();
    expect(getAccounts).not.toHaveBeenCalled();
    expect(vaultSigner.signOperations).not.toHaveBeenCalled();
    expect(statics.legacySigner.signOperations).not.toHaveBeenCalled();

    // The in-flight guard reset: a subsequent MATCHING request signs normally.
    startSign();
    expect(await screen.findByTestId('vault-signing-dialog')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('cancel resolves cancelled with no error surface, and the next request starts fresh', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-dialog');
    fireEvent.change(passwordInput(), { target: { value: 'typed-but-cancelled' } });
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'cancelled' });
    expect(vaultSigner.signOperations).not.toHaveBeenCalled();

    // A second request re-opens with a cleared password field (Radix content
    // unmounted between dialogs).
    startSign();
    await screen.findByTestId('vault-signing-dialog');
    expect((passwordInput() as HTMLInputElement).value).toBe('');
  });

  it('multiple candidates render radios and require an explicit choice', async () => {
    const directory = [
      {
        accountName: 'alice',
        balances: null,
        keys: [
          { role: 'active', iv: 'iv-a', note: 'first', publicKey: null },
          { role: 'owner', iv: 'iv-o', note: 'second', publicKey: null },
        ],
      },
    ];
    const getAccounts = vi.fn().mockResolvedValue(directory);
    const { vaultSigner } = readyRuntime({ getAccounts });
    vi.mocked(vaultSigner.signOperations).mockResolvedValue(signResult());
    renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-key-options');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    // Nothing selected by default; submit stays disabled.
    expect(radios.every((radio) => (radio as HTMLInputElement).checked === false)).toBe(true);
    expect(screen.getByTestId('vault-signing-submit')).toBeDisabled();

    fireEvent.click(screen.getByTestId('vault-signing-key-iv-o'));
    fireEvent.change(passwordInput(), { target: { value: 'pw' } });
    expect(screen.getByTestId('vault-signing-submit')).toBeEnabled();
    await submitDialog();

    await waitFor(() => expect(outcomes).toHaveLength(1));
    // The candidate's OWN storage role rides the request.
    expect(vaultSigner.signOperations).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'owner', keyIv: 'iv-o' }),
    );
  });

  it('signer authority failures surface the mapped code in-dialog and never resolve as errors', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    vi.mocked(vaultSigner.signOperations).mockRejectedValue(
      new VaultError('VAULT_AUTHORITY_UNAVAILABLE', 'chain data unavailable'),
    );
    renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-dialog');
    fireEvent.change(passwordInput(), { target: { value: 'pw' } });
    await submitDialog();

    expect(await screen.findByText('errors.VAULT_AUTHORITY_UNAVAILABLE')).toBeInTheDocument();
    expect(outcomes).toHaveLength(0);
    // Still cancellable.
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
  });

  it('directory load failures show the mapped error with Retry (recovered without a new dialog)', async () => {
    const getAccounts = vi
      .fn()
      .mockRejectedValueOnce(new VaultError('VAULT_EMPTY', 'nothing to resolve'))
      .mockResolvedValueOnce(directoryFixture());
    const { vaultSigner } = readyRuntime({ getAccounts });
    vi.mocked(vaultSigner.signOperations).mockResolvedValue(signResult());
    renderHarness(vaultAuth());

    startSign();
    expect(await screen.findByTestId('vault-signing-error')).toBeInTheDocument();
    expect(screen.getByText('errors.VAULT_EMPTY')).toBeInTheDocument();
    expect(outcomes).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByText('hardware active key')).toBeInTheDocument());
    fireEvent.change(passwordInput(), { target: { value: 'pw' } });
    await submitDialog();
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({ status: 'signed' });
  });

  it('an account with no eligible key shows the no-keys notice + vault management entry (cancel outcome)', async () => {
    const getAccounts = vi.fn().mockResolvedValue([
      {
        accountName: 'alice',
        balances: null,
        // Only a posting key: below the 'active' floor.
        keys: [{ role: 'posting', iv: 'iv-p', note: '', publicKey: null }],
      },
    ]);
    readyRuntime({ getAccounts });
    const onOpen = vi.fn();
    window.addEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
    renderHarness(vaultAuth());

    startSign();
    expect(await screen.findByTestId('vault-signing-no-keys')).toBeInTheDocument();
    expect(screen.getByText('signDialogNoKeys')).toBeInTheDocument();
    expect(screen.getByText('signDialogNoKeysHint')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'openVaultManagement' }));
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
  });

  it('the unavailable runtime surfaces its mapped code inside the dialog', async () => {
    mockRuntime = { state: 'unavailable', code: 'VAULT_STORAGE_UNAVAILABLE', retry: vi.fn() };
    renderHarness(vaultAuth());

    startSign();
    expect(await screen.findByTestId('vault-signing-error')).toBeInTheDocument();
    expect(screen.getByText('errors.VAULT_STORAGE_UNAVAILABLE')).toBeInTheDocument();
    expect(outcomes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
  });

  it('a second concurrent sign() resolves cancelled immediately (single in-flight)', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    readyRuntime({ getAccounts });
    renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-dialog');
    startSign();
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
    // The first request is still pending on the dialog.
    expect(screen.getByTestId('vault-signing-dialog')).toBeInTheDocument();
  });

  it('resolves cancelled when the host unmounts mid-dialog (no dangling promise)', async () => {
    const getAccounts = vi.fn().mockResolvedValue(directoryFixture());
    readyRuntime({ getAccounts });
    const view = renderHarness(vaultAuth());

    startSign();
    await screen.findByTestId('vault-signing-dialog');
    view.unmount();
    await waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
  });
});

describe('useSessionSigning — outcome discrimination', () => {
  it('signed outcomes carry the SignResult verbatim', async () => {
    const result = signResult();
    readyRuntime({});
    vi.mocked(statics.legacySigner.signOperations).mockResolvedValue(result);
    renderHarness(privateKeyAuth());

    startSign();
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toEqual({ status: 'signed', result });
  });
});
