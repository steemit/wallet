/**
 * VaultKeyManager + ImportKeyDialog (R2) — jsdom coverage with a fully
 * mocked manager and a mocked on-chain verification module (no IndexedDB,
 * no crypto, no network).
 *
 * Focus areas from the R2 acceptance:
 *  - LOCKED-STATE BROWSING: the directory (accounts / role counts / outer
 *    notes) renders straight from the public getAccounts API with no unlock
 *    (unlockVault is never called);
 *  - add flow: local WIF validation -> mocked verifyKeysOnChain (matched /
 *    sub-threshold / not-on-chain branches) -> explicit confirm ->
 *    manager.addKey; the idempotent no-op (directory count unchanged) is
 *    reported as "already stored";
 *  - verification failure (VAULT_AUTHORITY_UNAVAILABLE) blocks the add;
 *  - removal locates the key by account + role + IV behind a second
 *    confirmation; note updates ride updateKeyNote;
 *  - leak assertions: the WIF and the vault password never appear in the
 *    rendered tree (React writes controlled values as DOM properties, not
 *    attributes — the established panel-test pattern).
 *
 * The steem-js global mock derives 'STM' + last 8 chars of the WIF, so the
 * expected public key is computed the same way here; branch coverage only —
 * real crypto evidence lives in tests/node/vault-wif-real-check.mjs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { VaultKeyManager } from '@/components/vault/vault-key-manager';
import { VaultError } from '@/lib/vault/errors';
import type { VaultKeyChainMatch } from '@/lib/vault/key-management';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultAccountSummary, VaultKeyInput, VaultKeyPointer } from '@/lib/vault/types';
import { normalizeSteemUsername } from '@/lib/steem/username';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockVerifyKeysOnChain = vi.fn();
vi.mock('@/lib/vault/key-management', () => ({
  verifyKeysOnChain: (...args: unknown[]) => mockVerifyKeysOnChain(...args),
}));

// jsdom lacks radix's pointer-capture APIs and ResizeObserver.
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

const VAULT = 'Main';
const WIF = '5Jtest-alice-posting-key';
// The vitest steem-js mock derives 'STM' + the last 8 characters of the WIF.
const DERIVED_PUBLIC_KEY = `STM${WIF.slice(-8)}`;
// A public key already persisted on a stored entry (public data — shown
// truncated with a copy button in the key manager's second row).
const STORED_PUBLIC_KEY = 'STMABCD1234EFGH5678';
const VAULT_PASSWORD = 'the-vault-password-1';

/** Matched, threshold-satisfying posting result (happy path default). */
const MATCHED: VaultKeyChainMatch = {
  matched: true,
  authority: 'posting',
  weight: 1,
  threshold: 1,
  suffices: true,
};

function directory(): VaultAccountSummary[] {
  return [
    {
      accountName: 'alice',
      keys: [
        // Carries the outer publicKey field: the manager renders its second row.
        { role: 'posting', iv: 'ivalicepost', note: 'desktop key', publicKey: STORED_PUBLIC_KEY },
        // Legacy entry without the field: no second row renders.
        { role: 'memo', iv: 'ivalicememo', note: '', publicKey: null },
      ],
      balances: null,
    },
    {
      accountName: 'bob',
      keys: [{ role: 'owner', iv: 'ivbobowner', note: 'cold backup', publicKey: null }],
      balances: null,
    },
  ];
}

type ManagerState = {
  manager: VaultManagerExtended;
  directory: VaultAccountSummary[];
};

/** A manager mock whose getAccounts serves a mutable directory. */
function makeManager(initial: VaultAccountSummary[] = directory()): ManagerState {
  const state: ManagerState = { manager: null as unknown as VaultManagerExtended, directory: initial };
  state.manager = {
    getAccounts: vi.fn(async () => state.directory.map((account) => ({ ...account }))),
    addKey: vi.fn(async (input: VaultKeyInput) => {
      state.directory = [
        ...state.directory.filter((account) => account.accountName !== input.accountName),
        {
          accountName: input.accountName,
          keys: [
            ...(state.directory.find((a) => a.accountName === input.accountName)?.keys ?? []),
            { role: input.role, iv: `ivnew${state.directory.length}`, note: input.note, publicKey: input.publicKey ?? null },
          ],
          balances: null,
        },
      ];
      return {} as never;
    }),
    removeKey: vi.fn(async (pointer: VaultKeyPointer) => {
      state.directory = state.directory
        .map((account) =>
          account.accountName === pointer.accountName
            ? { ...account, keys: account.keys.filter((key) => key.iv !== pointer.keyIv) }
            : account,
        )
        .filter((account) => account.keys.length > 0);
      return {} as never;
    }),
    updateKeyNote: vi.fn(async (pointer: VaultKeyPointer, note: string) => {
      state.directory = state.directory.map((account) =>
        account.accountName === pointer.accountName
          ? {
              ...account,
              keys: account.keys.map((key) =>
                key.iv === pointer.keyIv ? { ...key, note } : key,
              ),
            }
          : account,
      );
      return {} as never;
    }),
    unlockVault: vi.fn(),
  } as unknown as VaultManagerExtended;
  return state;
}

/** Secrets that must never appear in rendered HTML. */
const SECRET_SUBSTRINGS = [WIF, VAULT_PASSWORD, '5J', '5K', '5H', 'kek'] as const;

function expectNoSecrets() {
  const html = document.body.innerHTML;
  for (const secret of SECRET_SUBSTRINGS) {
    expect(html, `rendered tree leaked "${secret}"`).not.toContain(secret);
  }
}

/** Open the add-key dialog and drive it through verification. */
async function verifyAddKey(match: VaultKeyChainMatch) {
  mockVerifyKeysOnChain.mockResolvedValueOnce([match]);
  fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
  await screen.findByTestId('vault-add-key-form');
  fireEvent.change(document.getElementById('vault-add-key-account') as HTMLInputElement, {
    target: { value: 'alice' },
  });
  fireEvent.change(document.getElementById('vault-add-key-wif') as HTMLInputElement, {
    target: { value: WIF },
  });
  fireEvent.change(document.getElementById('vault-add-key-password') as HTMLInputElement, {
    target: { value: VAULT_PASSWORD },
  });
  fireEvent.click(screen.getByTestId('vault-add-key-primary'));
  await screen.findByTestId('vault-add-key-verification');
}

describe('VaultKeyManager (R2 key management)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the public directory locked (no unlock): accounts, role counts and notes', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);

    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    expect(alice).toHaveAttribute('data-account', 'alice');
    expect(alice).toHaveTextContent('alice');
    expect(alice).toHaveTextContent('desktop key');
    // Role counts line renders the four role labels.
    expect(alice).toHaveTextContent('keysRolePosting');
    const bob = document.querySelectorAll('[data-testid="vault-key-account"]')[1];
    expect(bob).toHaveTextContent('cold backup');
    // A key with no note shows the placeholder.
    expect(alice).toHaveTextContent('keysNoNote');
    // The whole browsing surface never asks for an unlock.
    expect(state.manager.unlockVault).not.toHaveBeenCalled();
    expectNoSecrets();
  });

  it('empty directory shows the empty hint', async () => {
    const state = makeManager([]);
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    expect(await screen.findByText('keysEmpty')).toBeInTheDocument();
  });

  it('add flow (matched): verify then confirm stores the key; success banner; no leaks', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey(MATCHED);
    // One batched verification call carrying ONLY the public key + account.
    expect(mockVerifyKeysOnChain).toHaveBeenCalledTimes(1);
    expect(mockVerifyKeysOnChain).toHaveBeenCalledWith([
      { accountName: 'alice', role: 'posting', publicKey: DERIVED_PUBLIC_KEY },
    ]);
    expect(screen.getByTestId('vault-add-key-verification')).toHaveTextContent('verifyMatched');

    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await waitFor(() => {
      expect(state.manager.addKey).toHaveBeenCalledWith(
        expect.objectContaining({
          vaultName: VAULT,
          accountName: 'alice',
          role: 'posting',
          privateKey: WIF,
          note: '',
          password: VAULT_PASSWORD,
          // The key derived during verification rides along so the locked
          // key manager can display it.
          publicKey: DERIVED_PUBLIC_KEY,
        }),
      );
    });
    // Dialog closes; the "added" banner shows; the refreshed directory has
    // the new key; nothing sensitive is left in the tree.
    await screen.findByText('keyAdded');
    await waitFor(() => {
      expect(screen.queryByTestId('vault-add-key-form')).not.toBeInTheDocument();
    });
    expectNoSecrets();
  });

  it('add flow (sub-threshold): warning shown, confirm still stores the key', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey({
      matched: true,
      authority: 'active',
      weight: 1,
      threshold: 2,
      suffices: false,
    });
    expect(screen.getByTestId('vault-add-key-verification')).toHaveTextContent(
      'verifySubthreshold',
    );

    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await waitFor(() => {
      expect(state.manager.addKey).toHaveBeenCalled();
    });
    expectNoSecrets();
  });

  it('add flow (not on chain): warning shown, confirm still stores the key', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey({
      matched: false,
      authority: 'posting',
      weight: 0,
      threshold: 0,
      suffices: false,
    });
    expect(screen.getByTestId('vault-add-key-verification')).toHaveTextContent(
      'verifyNotOnChain',
    );

    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await waitFor(() => {
      expect(state.manager.addKey).toHaveBeenCalled();
    });
    await screen.findByText('keyAdded');
    expectNoSecrets();
  });

  it('verification failure blocks the add with the mapped error', async () => {
    const state = makeManager();
    mockVerifyKeysOnChain.mockRejectedValueOnce(
      new VaultError('VAULT_AUTHORITY_UNAVAILABLE', 'chain down'),
    );
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
    await screen.findByTestId('vault-add-key-form');
    fireEvent.change(document.getElementById('vault-add-key-account') as HTMLInputElement, {
      target: { value: 'alice' },
    });
    fireEvent.change(document.getElementById('vault-add-key-wif') as HTMLInputElement, {
      target: { value: WIF },
    });
    fireEvent.change(document.getElementById('vault-add-key-password') as HTMLInputElement, {
      target: { value: VAULT_PASSWORD },
    });
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));

    expect(await screen.findByText('errors.VAULT_AUTHORITY_UNAVAILABLE')).toBeInTheDocument();
    expect(state.manager.addKey).not.toHaveBeenCalled();
    expect(screen.queryByTestId('vault-add-key-verification')).not.toBeInTheDocument();
  });

  it('a locally invalid account name is rejected before any chain query', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
    await screen.findByTestId('vault-add-key-form');
    fireEvent.change(document.getElementById('vault-add-key-account') as HTMLInputElement, {
      target: { value: 'not a steem name!' },
    });
    fireEvent.change(document.getElementById('vault-add-key-wif') as HTMLInputElement, {
      target: { value: WIF },
    });
    fireEvent.change(document.getElementById('vault-add-key-password') as HTMLInputElement, {
      target: { value: VAULT_PASSWORD },
    });
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));

    expect(await screen.findByText('errors.VAULT_KEY_INVALID')).toBeInTheDocument();
    expect(mockVerifyKeysOnChain).not.toHaveBeenCalled();
    expect(state.manager.addKey).not.toHaveBeenCalled();
  });

  it('idempotent no-op: an unchanged directory after addKey reports "already stored"', async () => {
    // getAccounts returns the SAME directory before and after — the service
    // no-op shape (duplicate detected, nothing written).
    const state: ManagerState = {
      manager: null as unknown as VaultManagerExtended,
      directory: directory(),
    };
    const frozen = state.directory;
    state.manager = {
      getAccounts: vi.fn(async () => frozen.map((account) => ({ ...account }))),
      addKey: vi.fn(async () => ({} as never)),
      removeKey: vi.fn(async () => ({} as never)),
      updateKeyNote: vi.fn(async () => ({} as never)),
      unlockVault: vi.fn(),
    } as unknown as VaultManagerExtended;

    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey(MATCHED);
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await screen.findByText('keyAlreadyExists');
    expect(state.manager.addKey).toHaveBeenCalledTimes(1);
    expectNoSecrets();
  });

  it('removal asks for confirmation and locates the key by account + role + IV', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    const postingRow = within(alice).getAllByTestId('vault-key-row')[0] as HTMLElement;

    fireEvent.click(within(postingRow).getByRole('button', { name: 'keysRemoveKey' }));
    expect(await screen.findByTestId('vault-remove-key-dialog')).toHaveTextContent(
      'keysRemoveTitle',
    );
    // Nothing removed before the explicit confirmation.
    expect(state.manager.removeKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'keysRemoveConfirm' }));
    await waitFor(() => {
      expect(state.manager.removeKey).toHaveBeenCalledWith({
        vaultName: VAULT,
        accountName: 'alice',
        role: 'posting',
        keyIv: 'ivalicepost',
      });
    });
    await screen.findByText('keysRemoved');
    // The refreshed directory no longer lists the removed note.
    await waitFor(() => {
      expect(screen.queryByText('desktop key')).not.toBeInTheDocument();
    });
  });

  it('note editing is prefilled and saves through updateKeyNote', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    const postingRow = within(alice).getAllByTestId('vault-key-row')[0] as HTMLElement;

    fireEvent.click(within(postingRow).getByRole('button', { name: 'keysEditNote' }));
    await screen.findByText('keysNoteTitle');
    const input = document.getElementById('vault-key-note-input') as HTMLInputElement;
    expect(input.value).toBe('desktop key');

    fireEvent.change(input, { target: { value: 'laptop key' } });
    fireEvent.click(screen.getByRole('button', { name: 'keysNoteSave' }));
    await waitFor(() => {
      expect(state.manager.updateKeyNote).toHaveBeenCalledWith(
        { vaultName: VAULT, accountName: 'alice', role: 'posting', keyIv: 'ivalicepost' },
        'laptop key',
      );
    });
    await screen.findByText('keysNoteSaved');
    await screen.findByText('laptop key');
  });

  // -------------------------------------------------------------------------
  // R2 quick-review follow-ups (R3 batch)
  // -------------------------------------------------------------------------

  /** Open the add-key dialog and type the sensitive fields (no submit). */
  async function openAndFillAddKey() {
    fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
    await screen.findByTestId('vault-add-key-form');
    fireEvent.change(document.getElementById('vault-add-key-account') as HTMLInputElement, {
      target: { value: 'alice' },
    });
    fireEvent.change(document.getElementById('vault-add-key-wif') as HTMLInputElement, {
      target: { value: WIF },
    });
    fireEvent.change(document.getElementById('vault-add-key-password') as HTMLInputElement, {
      target: { value: VAULT_PASSWORD },
    });
  }

  /** The sensitive inputs of a (re)opened dialog start empty. */
  function expectEmptySensitiveInputs() {
    expect((document.getElementById('vault-add-key-wif') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('vault-add-key-password') as HTMLInputElement).value).toBe(
      '',
    );
  }

  it('cancel scrubs the WIF and password: dialog closes, nothing leaks, reopening starts empty', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await openAndFillAddKey();
    expect((document.getElementById('vault-add-key-wif') as HTMLInputElement).value).toBe(WIF);

    fireEvent.click(screen.getByRole('button', { name: 'cancelAction' }));
    await waitFor(() => {
      expect(screen.queryByTestId('vault-add-key-form')).not.toBeInTheDocument();
    });
    expectNoSecrets();

    fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
    await screen.findByTestId('vault-add-key-form');
    expectEmptySensitiveInputs();
    expect(state.manager.addKey).not.toHaveBeenCalled();
    expect(mockVerifyKeysOnChain).not.toHaveBeenCalled();
  });

  it('dismissing the dialog (Esc unmounts the form) also leaves no WIF behind', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    // Mid-flow: verified but NOT confirmed — the WIF sits in the form state.
    await verifyAddKey(MATCHED);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('vault-add-key-form')).not.toBeInTheDocument();
    });
    expectNoSecrets();

    fireEvent.click(screen.getByRole('button', { name: 'keysAddKey' }));
    await screen.findByTestId('vault-add-key-form');
    expectEmptySensitiveInputs();
    // The verification snapshot did not survive the unmount either.
    expect(screen.queryByTestId('vault-add-key-verification')).not.toBeInTheDocument();
    expect(state.manager.addKey).not.toHaveBeenCalled();
  });

  it('unmounting the whole key manager with a typed WIF leaves nothing in the document', async () => {
    const state = makeManager();
    const { unmount } = render(
      <VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />,
    );
    await screen.findAllByTestId('vault-key-account');

    await openAndFillAddKey();
    unmount();
    expectNoSecrets();
    expect(document.getElementById('vault-add-key-wif')).toBeNull();
    expect(state.manager.addKey).not.toHaveBeenCalled();
  });

  /** Select a role, then verify with the given chain result. */
  async function verifyWithRole(role: string, match: VaultKeyChainMatch) {
    mockVerifyKeysOnChain.mockResolvedValueOnce([match]);
    await openAndFillAddKey();
    fireEvent.change(document.getElementById('vault-add-key-role') as HTMLSelectElement, {
      target: { value: role },
    });
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    return screen.findByTestId('vault-add-key-verification');
  }

  it('authority differs from the selected role (memo selected, posting matched): WARN tone + stored-as-selected copy', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    const box = await verifyWithRole('memo', MATCHED);
    expect(box).toHaveTextContent('verifyAuthorityDiffers');
    expect(box).not.toHaveTextContent('verifyMatched');
    // Warn tone (amber), never the green "verified" box.
    expect(box.className).toContain('amber');
    expect(box.className).not.toContain('emerald');

    // Still storable — under the SELECTED role.
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await waitFor(() => {
      expect(state.manager.addKey).toHaveBeenCalledWith(
        expect.objectContaining({ accountName: 'alice', role: 'memo' }),
      );
    });
    expectNoSecrets();
  });

  it('authority differs the other way (posting selected, memo key matched): WARN, not the green memo verdict', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    const box = await verifyWithRole('posting', {
      matched: true,
      authority: 'memo',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
    expect(box).toHaveTextContent('verifyAuthorityDiffers');
    expect(box.className).toContain('amber');
  });

  it('memo selected and memo matched keeps the green memo verdict', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    const box = await verifyWithRole('memo', {
      matched: true,
      authority: 'memo',
      weight: 1,
      threshold: 1,
      suffices: true,
    });
    expect(box).toHaveTextContent('verifyMemo');
    expect(box.className).toContain('emerald');
  });

  it('sub-threshold outranks authority-differs (the signer-rejection warning wins)', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    const box = await verifyWithRole('posting', {
      matched: true,
      authority: 'active',
      weight: 1,
      threshold: 2,
      suffices: false,
    });
    expect(box).toHaveTextContent('verifySubthreshold');
    expect(box).not.toHaveTextContent('verifyAuthorityDiffers');
  });

  it('added-vs-duplicate detection compares account names through normalization (non-canonical stored name)', async () => {
    // A directory entry whose STORED name is not canonical (e.g. from an
    // imported backup) — the service matches it by normalized name, so the
    // new key lands under 'ALICE'. A raw `===` against the verified 'alice'
    // would count 0 before and after and mislabel the add as a duplicate.
    const state: ManagerState = {
      manager: null as unknown as VaultManagerExtended,
      directory: [
        {
          accountName: 'ALICE',
          keys: [{ role: 'posting', iv: 'ivalicepost', note: 'desktop key', publicKey: null }],
          balances: null,
        },
      ],
    };
    state.manager = {
      getAccounts: vi.fn(async () => state.directory.map((account) => ({ ...account }))),
      addKey: vi.fn(async (input: VaultKeyInput) => {
        state.directory = state.directory.map((account) =>
          normalizeSteemUsername(account.accountName) === normalizeSteemUsername(input.accountName)
            ? {
                ...account,
                keys: [
                  ...account.keys,
                  { role: input.role, iv: 'ivnewkey', note: input.note, publicKey: input.publicKey ?? null },
                ],
              }
            : account,
        );
        return {} as never;
      }),
      removeKey: vi.fn(),
      updateKeyNote: vi.fn(),
      unlockVault: vi.fn(),
    } as unknown as VaultManagerExtended;

    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey(MATCHED);
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    expect(await screen.findByText('keyAdded')).toBeInTheDocument();
    expect(screen.queryByText('keyAlreadyExists')).not.toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------------
// Public-key second row (outer publicKey display + copy)
// -----------------------------------------------------------------------------

describe('VaultKeyManager public-key rows', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('renders a truncated monospace public key with a copy button; legacy rows get no second line', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    const postingRow = within(alice).getAllByTestId('vault-key-row')[0] as HTMLElement;

    // Truncated display: STM + first 4 + ellipsis + last 4. The FULL key is
    // exposed only via the hover title, never as rendered text.
    const line = within(postingRow).getByTestId('vault-key-public-key');
    expect(line).toHaveTextContent('STMABCD…5678');
    expect(line.querySelector('code')).toHaveAttribute('title', STORED_PUBLIC_KEY);
    expect(line).not.toHaveTextContent(STORED_PUBLIC_KEY);
    expect(within(line).getByRole('button', { name: 'keysPublicKeyCopy' })).toBeInTheDocument();

    // A legacy entry without the outer field renders NO second line (no
    // placeholder — the row stays compact).
    const memoRow = within(alice).getAllByTestId('vault-key-row')[1] as HTMLElement;
    expect(within(memoRow).queryByTestId('vault-key-public-key')).not.toBeInTheDocument();
    const bob = document.querySelectorAll('[data-testid="vault-key-account"]')[1] as HTMLElement;
    expect(within(bob).queryByTestId('vault-key-public-key')).not.toBeInTheDocument();
    expectNoSecrets();
  });

  it('the copy button writes the FULL public key and flips to the copied state', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    const postingRow = within(alice).getAllByTestId('vault-key-row')[0] as HTMLElement;
    const line = within(postingRow).getByTestId('vault-key-public-key');

    fireEvent.click(within(line).getByRole('button', { name: 'keysPublicKeyCopy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    // The clipboard receives the COMPLETE key, not the truncated form.
    expect(writeText).toHaveBeenCalledWith(STORED_PUBLIC_KEY);
    // Brief copied feedback replaces the copy affordance.
    expect(await within(line).findByRole('button', { name: 'keysPublicKeyCopied' })).toBeInTheDocument();
    expect(within(line).queryByRole('button', { name: 'keysPublicKeyCopy' })).not.toBeInTheDocument();
    expectNoSecrets();
  });

  it('a clipboard rejection keeps the copy affordance without crashing', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    const alice = (await screen.findAllByTestId('vault-key-account'))[0] as HTMLElement;
    const postingRow = within(alice).getAllByTestId('vault-key-row')[0] as HTMLElement;
    const line = within(postingRow).getByTestId('vault-key-public-key');

    fireEvent.click(within(line).getByRole('button', { name: 'keysPublicKeyCopy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    // No copied flip; the row still renders.
    expect(within(line).getByRole('button', { name: 'keysPublicKeyCopy' })).toBeInTheDocument();
    expect(within(line).queryByRole('button', { name: 'keysPublicKeyCopied' })).not.toBeInTheDocument();
  });

  it('a freshly added key (publicKey passed through addKey) renders its second row after refresh', async () => {
    const state = makeManager();
    render(<VaultKeyManager vaultName={VAULT} manager={state.manager} onBack={() => undefined} />);
    await screen.findAllByTestId('vault-key-account');

    await verifyAddKey(MATCHED);
    fireEvent.click(screen.getByTestId('vault-add-key-primary'));
    await screen.findByText('keyAdded');
    // The refreshed directory lists the new posting key with the verified
    // public key; the vitest steem-js mock truncation shows it un-truncated
    // (≤ 12 chars render as-is).
    await waitFor(() => {
      expect(state.manager.addKey).toHaveBeenCalled();
    });
    const newIvRow = document.querySelector('[data-key-iv="ivnew2"]');
    expect(newIvRow).not.toBeNull();
    const line = within(newIvRow as HTMLElement).getByTestId('vault-key-public-key');
    expect(line).toHaveTextContent(DERIVED_PUBLIC_KEY);
  });
});
