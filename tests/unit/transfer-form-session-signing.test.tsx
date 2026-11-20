/**
 * TransferForm × useSessionSigning integration (A6-T2) — the pilot caller in
 * all three session shapes. The hook is mocked at its module boundary (its
 * own matrix lives in use-session-signing.test.tsx); these tests pin what
 * the FORM does with each outcome:
 *   - vault identity session: submit is no longer blocked by the absence of
 *     a Redux signing key — the confirm step signs through the unified entry
 *     and broadcasts on success (cancel = silent no-op);
 *   - privateKey session missing its key: `needsClassicReauth` opens the
 *     EXISTING classic re-auth dialog (embedded LoginForm, locked username);
 *   - typed errors surface through the form's existing error box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { TransferForm } from '@/components/wallet/transfer-form';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockFetchAccounts = vi.fn();
vi.mock('@/lib/steem/accounts-client', () => ({
  fetchAccounts: (...args: unknown[]) => mockFetchAccounts(...args),
}));

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    broadcastTransfer: (...args: unknown[]) => mocks.broadcast(...args),
  },
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: vi.fn(),
}));

function vaultStore(username = 'alice') {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        username: null,
        ownerKey: null,
        activeKey: null,
        postingKey: null,
        memoKey: null,
        privateKey: null,
        publicKey: null,
        isAuthenticated: false,
        sessionKind: 'privateKey',
      } satisfies AuthState,
    },
  });
  store.dispatch(setVaultIdentity({ username }));
  return store;
}

function balancesResponse() {
  return {
    success: true,
    accounts: [
      {
        name: 'alice',
        balance: '5.000 STEEM',
        sbd_balance: '0.000 SBD',
        savings_balance: '0.000 STEEM',
        savings_sbd_balance: '0.000 SBD',
        memo_key: 'STM6TESTKEY',
      },
    ],
  };
}

async function renderAndOpenPreview() {
  mockFetchAccounts.mockResolvedValue(balancesResponse());
  render(
    <Provider store={vaultStore()}>
      <TransferForm variant="dialog" initialTransferType="transfer" initialAsset="STEEM" />
    </Provider>,
  );
  fireEvent.change(await screen.findByLabelText('to'), { target: { value: 'bob' } });
  fireEvent.change(await screen.findByLabelText('amount'), { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'continueButton' }));
  expect(await screen.findByText('confirmDescription')).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransferForm — vault identity session (no Redux keys)', () => {
  it('submit is NOT blocked by the missing signing key; confirm signs and broadcasts', async () => {
    mocks.sign.mockResolvedValue({ status: 'signed', result: { signedTx: { id: 'tx' } } });
    mocks.broadcast.mockResolvedValue({ success: true });
    await renderAndOpenPreview();

    // The preview is open with no "notAuthenticated" dead-end.
    expect(screen.queryByText('notAuthenticated')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'confirmButton' }));

    await waitFor(() => {
      expect(mocks.sign).toHaveBeenCalledWith({
        operations: [
          ['transfer', { from: 'alice', to: 'bob', amount: '1.500 STEEM', memo: '' }],
        ],
        accountName: 'alice',
        role: 'active',
      });
    });
    await waitFor(() => expect(mocks.broadcast).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('notAuthenticated')).not.toBeInTheDocument();
  });

  it('a user cancel in the signing dialog is a silent no-op (no error, no broadcast)', async () => {
    mocks.sign.mockResolvedValue({ status: 'cancelled' });
    await renderAndOpenPreview();

    fireEvent.click(screen.getByRole('button', { name: 'confirmButton' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(mocks.broadcast).not.toHaveBeenCalled();
    // No error banner — the review stays quietly open.
    expect(screen.queryByText('Failed to process transfer')).not.toBeInTheDocument();
    expect(screen.getByText('confirmDescription')).toBeInTheDocument();
  });

  it('a typed error outcome surfaces the existing transfer error copy', async () => {
    mocks.sign.mockResolvedValue({ status: 'error', code: 'VAULT_STORAGE_UNAVAILABLE' });
    await renderAndOpenPreview();

    fireEvent.click(screen.getByRole('button', { name: 'confirmButton' }));

    // The error text renders in the form body and inside the review dialog.
    await waitFor(() => {
      expect(screen.getAllByText('Failed to process transfer').length).toBeGreaterThan(0);
    });
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});

describe('TransferForm — privateKey session missing its key', () => {
  it('needsClassicReauth opens the existing classic re-auth dialog with the locked username', async () => {
    mocks.sign.mockResolvedValue({ status: 'needsClassicReauth' });
    await renderAndOpenPreview();

    fireEvent.click(screen.getByRole('button', { name: 'confirmButton' }));

    // The embedded classic re-auth form (dispatcher falls back to the
    // PrivateKey body when no vault runtime resolves in tests).
    const usernameInput = await waitFor(() => {
      const el = document.getElementById('wallet-reauth-username') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    expect(usernameInput.value).toBe('alice');
    expect(usernameInput).toHaveAttribute('readonly');
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
