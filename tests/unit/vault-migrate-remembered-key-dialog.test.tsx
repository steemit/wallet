/**
 * MigrateRememberedKeyDialog (A6-T5) — jsdom coverage with a mocked manager
 * and a mocked on-chain verification module (no IndexedDB, no crypto, no
 * network). The full verified-readback chain is covered by
 * tests/unit/vault-migration.test.ts against the real manager; here the
 * concerns are the dialog contract:
 *  - the confirmation copy (what/why/consequences) renders before anything
 *    can proceed, with the account and the derived PUBLIC key;
 *  - the remembered-WIF leak discipline: the component never holds the WIF —
 *    only the PUBLIC candidate — and the WIF never appears in the tree;
 *  - verify -> verdict (shared KeyVerdictBox, matched tone) -> explicit
 *    confirm -> manager.migrateRememberedPostingKey called WITHOUT any WIF
 *    argument (the primitive re-reads localStorage itself);
 *  - failure mapping (wrong password -> errors.VAULT_PASSWORD_INVALID,
 *    authority unavailable -> errors.VAULT_AUTHORITY_UNAVAILABLE) keeps the
 *    dialog open and the plaintext untouched;
 *  - EMPTY-TARGET ANCHORING (review r1 P1-1): an empty target vault renders
 *    the confirm re-type + hint, mismatches block, weak passwords are
 *    rejected by the creation policy; non-empty targets keep one field;
 *  - scrub discipline (P3-5): cancel clears the typed password, the confirm
 *    field and the verdict;
 *  - nothing valid remembered at open -> the dismiss-only migrateMissing
 *    state.
 *
 * The steem-js global mock derives 'STM' + last 8 chars of the WIF, so the
 * expected public key is computed the same way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  MigrateRememberedKeyDialog,
  type MigrateRememberedKeyOutcome,
} from '@/components/vault/migrate-remembered-key-dialog';
import { VaultError } from '@/lib/vault/errors';
import type { VaultKeyChainMatch } from '@/lib/vault/key-management';
import type { VaultManagerExtended } from '@/lib/vault/manager';
import type { VaultAccountSummary } from '@/lib/vault/types';
import { validateVaultWif } from '@/lib/vault/validation';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';

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
const WIF = '5Jtest-alice-remembered-posting-key';
const DERIVED_PUBLIC_KEY = validateVaultWif(WIF, 'alice').publicKey;
const VAULT_PASSWORD = 'the-vault-password-1';

const MATCHED: VaultKeyChainMatch = {
  matched: true,
  authority: 'posting',
  weight: 1,
  threshold: 1,
  suffices: true,
};

const migrateMock = vi.fn();
const getAccountsMock = vi.fn();

/** A non-empty public directory (one stored posting key). */
function nonEmptyDirectory(): VaultAccountSummary[] {
  return [
    {
      accountName: 'alice',
      keys: [{ role: 'posting', iv: 'ivstored', note: 'stored', publicKey: 'STMstored' }],
      balances: null,
    },
  ];
}

function makeManager(): VaultManagerExtended {
  return {
    migrateRememberedPostingKey: migrateMock,
    getAccounts: getAccountsMock,
  } as unknown as VaultManagerExtended;
}

function renderDialog(onMigrated: (outcome: MigrateRememberedKeyOutcome) => void = vi.fn()) {
  const onOpenChange = vi.fn();
  const view = render(
    <MigrateRememberedKeyDialog
      open
      onOpenChange={onOpenChange}
      vaultName={VAULT}
      manager={makeManager()}
      onMigrated={onMigrated}
    />,
  );
  return { view, onOpenChange, onMigrated };
}

/** Drive the form to the confirm phase (verify done, verdict rendered). */
async function driveToConfirm() {
  const onMigrated = vi.fn<(outcome: MigrateRememberedKeyOutcome) => void>();
  const onOpenChange = vi.fn();
  render(
    <MigrateRememberedKeyDialog
      open
      onOpenChange={onOpenChange}
      vaultName={VAULT}
      manager={makeManager()}
      onMigrated={onMigrated}
    />,
  );
  fireEvent.change(await screen.findByLabelText('migratePasswordLabel'), {
    target: { value: VAULT_PASSWORD },
  });
  fireEvent.click(screen.getByTestId('vault-migrate-primary'));
  await waitFor(() =>
    expect(screen.getByTestId('vault-migrate-verification')).toBeInTheDocument(),
  );
  return { onMigrated, onOpenChange };
}

describe('MigrateRememberedKeyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, WIF);
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    mockVerifyKeysOnChain.mockResolvedValue([MATCHED]);
    migrateMock.mockResolvedValue({ outcome: 'migrated' });
    // Default: a NON-empty target vault (single verify field).
    getAccountsMock.mockResolvedValue(nonEmptyDirectory());
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders the confirmation copy with account and derived public key, WIF never in the tree', async () => {
    renderDialog();
    // The consequence bullets are the consent contract — all four render.
    expect(await screen.findByText('migrateWhatHappens')).toBeInTheDocument();
    expect(screen.getByText(/migrateStepVault/)).toBeInTheDocument();
    expect(screen.getByText('migrateStepDevice')).toBeInTheDocument();
    expect(screen.getByText('migrateStepClaim')).toBeInTheDocument();
    expect(screen.getByText('migrateStepUsername')).toBeInTheDocument();
    expect(screen.getByLabelText('migrateAccountLabel')).toHaveValue('alice');
    // The PUBLIC key renders truncated; the WIF itself never appears (the
    // dialog content portals to document.body, so query the body).
    expect(document.body.textContent).toContain(DERIVED_PUBLIC_KEY.slice(-4));
    expect(document.body.textContent).not.toContain(WIF);
    // Nothing can proceed without the vault password.
    expect(screen.getByTestId('vault-migrate-primary')).toBeDisabled();
  });

  it('verify -> matched verdict -> confirm calls the manager with NO key material, reports the outcome and closes', async () => {
    const { onMigrated, onOpenChange } = await driveToConfirm();
    expect(mockVerifyKeysOnChain).toHaveBeenCalledTimes(1);
    expect(mockVerifyKeysOnChain).toHaveBeenCalledWith([
      { accountName: 'alice', role: 'posting', publicKey: DERIVED_PUBLIC_KEY },
    ]);

    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await waitFor(() => expect(migrateMock).toHaveBeenCalledTimes(1));
    // The dialog hands over ONLY public data + the password: no WIF field —
    // the primitive re-reads localStorage inside the gated operation.
    expect(migrateMock).toHaveBeenCalledWith({
      vaultName: VAULT,
      expectedAccountName: 'alice',
      expectedPublicKey: DERIVED_PUBLIC_KEY,
      password: VAULT_PASSWORD,
    });
    expect(onMigrated).toHaveBeenCalledWith('migrated');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('wrong vault password: mapped error, dialog stays open, plaintext intact', async () => {
    migrateMock.mockRejectedValue(
      new VaultError('VAULT_PASSWORD_INVALID', 'authentication failed'),
    );
    const { onMigrated } = await driveToConfirm();

    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await waitFor(() => expect(migrateMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('errors.VAULT_PASSWORD_INVALID')).toBeInTheDocument();
    expect(onMigrated).not.toHaveBeenCalled();
    // The dialog is still open (no close callback) and the plaintext stays.
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
    // Retry after fixing the password succeeds.
    migrateMock.mockResolvedValue({ outcome: 'migrated' });
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await waitFor(() => expect(onMigrated).toHaveBeenCalledWith('migrated'));
  });

  it('authority unavailable: mapped error blocks the confirm phase', async () => {
    mockVerifyKeysOnChain.mockRejectedValue(
      new VaultError('VAULT_AUTHORITY_UNAVAILABLE', 'chain data unavailable'),
    );
    const onMigrated = vi.fn<(outcome: MigrateRememberedKeyOutcome) => void>();
    render(
      <MigrateRememberedKeyDialog
        open
        onOpenChange={vi.fn()}
        vaultName={VAULT}
        manager={makeManager()}
        onMigrated={onMigrated}
      />,
    );
    fireEvent.change(await screen.findByLabelText('migratePasswordLabel'), {
      target: { value: VAULT_PASSWORD },
    });
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    expect(await screen.findByText('errors.VAULT_AUTHORITY_UNAVAILABLE')).toBeInTheDocument();
    expect(migrateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
    expect(onMigrated).not.toHaveBeenCalled();
  });

  it('alreadyPresent outcome flows through as a success', async () => {
    migrateMock.mockResolvedValue({ outcome: 'alreadyPresent' });
    const { onMigrated } = await driveToConfirm();
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await waitFor(() => expect(onMigrated).toHaveBeenCalledWith('alreadyPresent'));
  });

  it('cancel in the confirm phase returns to the confirmation view without calling the manager', async () => {
    await driveToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'migrateEditAgain' }));
    expect(screen.queryByTestId('vault-migrate-verification')).not.toBeInTheDocument();
    expect(migrateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
  });

  it('nothing valid remembered at open: dismiss-only migrateMissing state, no manager call', async () => {
    window.localStorage.removeItem(REMEMBERED_POSTING_KEY_KEY);
    renderDialog();
    expect(await screen.findByText('migrateMissing')).toBeInTheDocument();
    expect(screen.queryByLabelText('migratePasswordLabel')).not.toBeInTheDocument();
    expect(migrateMock).not.toHaveBeenCalled();
  });

  it('scrub on cancel: the typed password, confirm field and verdict are cleared', async () => {
    const { onOpenChange } = await driveToConfirm();
    const passwordInput = screen.getByLabelText('migratePasswordLabel');
    expect((passwordInput as HTMLInputElement).value).toBe(VAULT_PASSWORD);
    expect(screen.getByTestId('vault-migrate-verification')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'migrateEditAgain' }));
    // Back first clears the verdict but keeps the password for a re-try...
    expect(screen.queryByTestId('vault-migrate-verification')).not.toBeInTheDocument();
    expect((passwordInput as HTMLInputElement).value).toBe(VAULT_PASSWORD);
    // ...while Cancel scrubs everything sensitive.
    fireEvent.click(screen.getByRole('button', { name: 'cancelAction' }));
    expect((passwordInput as HTMLInputElement).value).toBe('');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(migrateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
  });

  // -------------------------------------------------------------------------
  // Empty-target anchoring (review r1 P1-1)
  // -------------------------------------------------------------------------

  it('EMPTY target vault: confirm re-type + hint render; mismatch blocks and shows the mismatch error', async () => {
    getAccountsMock.mockResolvedValue([]);
    renderDialog();
    expect(await screen.findByText('migrateAnchorHint')).toBeInTheDocument();
    const passwordInput = screen.getByLabelText('migratePasswordLabel');
    const confirmInput = screen.getByLabelText('confirmPasswordLabel');
    expect(confirmInput).toBeInTheDocument();

    // Mismatch: the primary stays disabled and the mismatch error renders.
    fireEvent.change(passwordInput, { target: { value: VAULT_PASSWORD } });
    fireEvent.change(confirmInput, { target: { value: `${VAULT_PASSWORD}-typo` } });
    expect(screen.getByText('passwordMismatch')).toBeInTheDocument();
    expect(screen.getByTestId('vault-migrate-primary')).toBeDisabled();
    expect(migrateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
  });

  it('EMPTY target vault: a weak anchoring password is rejected by the creation policy before any chain work', async () => {
    getAccountsMock.mockResolvedValue([]);
    renderDialog();
    await screen.findByText('migrateAnchorHint');
    fireEvent.change(screen.getByLabelText('migratePasswordLabel'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    expect(await screen.findByText('errors.VAULT_PASSWORD_WEAK')).toBeInTheDocument();
    expect(mockVerifyKeysOnChain).not.toHaveBeenCalled();
    expect(migrateMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REMEMBERED_POSTING_KEY_KEY)).toBe(WIF);
  });

  it('EMPTY target vault: matching policy-valid confirm proceeds to the verdict and the migration', async () => {
    getAccountsMock.mockResolvedValue([]);
    const onMigrated = vi.fn<(outcome: MigrateRememberedKeyOutcome) => void>();
    const onOpenChange = vi.fn();
    render(
      <MigrateRememberedKeyDialog
        open
        onOpenChange={onOpenChange}
        vaultName={VAULT}
        manager={makeManager()}
        onMigrated={onMigrated}
      />,
    );
    await screen.findByText('migrateAnchorHint');
    fireEvent.change(screen.getByLabelText('migratePasswordLabel'), {
      target: { value: VAULT_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('confirmPasswordLabel'), {
      target: { value: VAULT_PASSWORD },
    });
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await screen.findByTestId('vault-migrate-verification');
    fireEvent.click(screen.getByTestId('vault-migrate-primary'));
    await waitFor(() => expect(onMigrated).toHaveBeenCalledWith('migrated'));
    expect(migrateMock).toHaveBeenCalledWith(
      expect.objectContaining({ password: VAULT_PASSWORD }),
    );
  });

  it('NON-EMPTY target vault: no confirm field is rendered', async () => {
    renderDialog();
    await screen.findByText('migrateWhatHappens');
    expect(screen.queryByLabelText('confirmPasswordLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('migrateAnchorHint')).not.toBeInTheDocument();
  });

  it('directory-read failure surfaces the mapped error with Retry — never a silent single-field fallback (r2)', async () => {
    // The target-directory read fails: the anchoring decision must stay
    // UNKNOWN (verify disabled), the mapped error must render, and only a
    // successful retry decides anchor vs non-anchor. Falling back to
    // anchorCase=false here would let a strong-but-typo'd password anchor a
    // truly-empty vault without re-entry.
    getAccountsMock.mockRejectedValueOnce(
      new VaultError('VAULT_STORAGE_UNAVAILABLE', 'directory read failed'),
    );
    renderDialog();
    const errorBox = await screen.findByTestId('vault-migrate-directory-error');
    expect(errorBox).toHaveTextContent('errors.VAULT_STORAGE_UNAVAILABLE');
    const retryButton = within(errorBox).getByRole('button', { name: 'retry' });
    expect(retryButton).toBeInTheDocument();

    // Verify stays blocked while the decision is unknown.
    fireEvent.change(await screen.findByLabelText('migratePasswordLabel'), {
      target: { value: VAULT_PASSWORD },
    });
    expect(screen.getByTestId('vault-migrate-primary')).toBeDisabled();
    expect(mockVerifyKeysOnChain).not.toHaveBeenCalled();

    // Retry resolves the directory (empty vault) and the confirm field appears.
    getAccountsMock.mockResolvedValue([]);
    fireEvent.click(retryButton);
    await screen.findByText('migrateAnchorHint');
    expect(screen.getByLabelText('confirmPasswordLabel')).toBeInTheDocument();
  });
});
