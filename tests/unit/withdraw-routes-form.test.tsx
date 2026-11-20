/**
 * WithdrawRoutesForm owner-gate regression tests (review finding C-1) plus
 * the A6-T3a session-signing integration.
 *
 * Reproduces the visible failure: session user "alice" (canonical, from
 * Redux) vs page URL account "Alice" (raw === comparison) made the routes
 * editor permanently read-only for the account owner. canEdit must compare
 * normalized account names.
 *
 * Since A6-T3a the form signs through the unified session signing entry
 * (`useSessionSigning`, mocked at its module boundary): privateKey sessions
 * sign through the facade's legacy backend, vault identity sessions through
 * the per-key password dialog — and a vault session no longer counts as
 * "no key" for the editor gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { WithdrawRoutesForm } from '@/components/wallet/withdraw-routes-form';

// jsdom lacks ResizeObserver, required by radix-ui (Checkbox measurement).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getWithdrawRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    broadcastSetWithdrawVestingRoute: vi.fn().mockResolvedValue({ success: true }),
  },
}));

function privateKeyStore(sessionUser: string): ReturnType<typeof configureStore> {
  const preloaded: { auth: AuthState } = {
    auth: {
      username: sessionUser,
      ownerKey: null,
      activeKey: '5J-test-active-key',
      postingKey: null,
      memoKey: null,
      privateKey: '5J-test-active-key',
      publicKey: 'STM-test',
      isAuthenticated: true,
    },
  };
  return configureStore({ reducer: { auth: authReducer }, preloadedState: preloaded });
}

function vaultStore(sessionUser: string): ReturnType<typeof configureStore> {
  const store = privateKeyStore(sessionUser);
  store.dispatch(setVaultIdentity({ username: sessionUser }));
  return store;
}

function signedOutcome() {
  return {
    status: 'signed' as const,
    result: { signedTx: { signatures: ['SIG'], operations: [] } },
  };
}

function renderForm(store: ReturnType<typeof configureStore>, accountUsername: string) {
  return render(
    <Provider store={store}>
      <WithdrawRoutesForm variant="page" accountUsername={accountUsername} isMyAccount />
    </Provider>
  );
}

describe('WithdrawRoutesForm — normalized owner check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue(signedOutcome());
  });

  it('is editable when the session user differs from the URL account only by case', async () => {
    renderForm(privateKeyStore('alice'), 'Alice');

    // Editable: the add-route form is present and the view-only hint is not.
    expect(await screen.findByText('addRoute')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('viewOnly')).not.toBeInTheDocument());
  });

  it('is read-only for a different account', async () => {
    renderForm(privateKeyStore('bob'), 'Alice');

    expect(await screen.findByText('viewOnly')).toBeInTheDocument();
    expect(screen.queryByText('addRoute')).not.toBeInTheDocument();
  });

  it('signs the byte-identical remove tuple for an existing route', async () => {
    const { apiClient } = await import('@/lib/steem/client');
    vi.mocked(apiClient.getWithdrawRoutes).mockResolvedValueOnce({
      routes: [{ to_account: 'bob', percent: 5000, auto_vest: true }],
    });
    renderForm(privateKeyStore('alice'), 'Alice');

    expect(await screen.findByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('50% — autoVestOn')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    // Byte-identical to what SteemSigner.signSetWithdrawVestingRoute built
    // before A6-T3a (remove = percent 0, auto_vest false).
    await waitFor(() =>
      expect(mocks.sign).toHaveBeenCalledWith({
        operations: [
          [
            'set_withdraw_vesting_route',
            { from_account: 'Alice', to_account: 'bob', percent: 0, auto_vest: false },
          ],
        ],
        accountName: 'alice',
        role: 'active',
      })
    );
  });

  it('validates destination and percent before adding a route', async () => {
    renderForm(privateKeyStore('alice'), 'Alice');
    await screen.findByText('addRoute');

    // Empty destination.
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('enterDestination');
  });

  it('signs the byte-identical add tuple with mixed-case page/session names', async () => {
    renderForm(privateKeyStore('alice'), 'Alice');
    await screen.findByText('addRoute');

    fireEvent.change(screen.getByLabelText('routeTo'), { target: { value: '@Bob' } });
    fireEvent.change(screen.getByLabelText(/percentLabel/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() =>
      expect(mocks.sign).toHaveBeenCalledWith({
        operations: [
          [
            'set_withdraw_vesting_route',
            { from_account: 'Alice', to_account: 'bob', percent: 2500, auto_vest: false },
          ],
        ],
        accountName: 'alice',
        role: 'active',
      })
    );
  });
});

describe('WithdrawRoutesForm — vault identity session (A6-T3a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue(signedOutcome());
  });

  it('is editable without a Redux key and signs the add tuple through the unified entry', async () => {
    renderForm(vaultStore('alice'), 'Alice');

    expect(await screen.findByText('addRoute')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('viewOnly')).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('routeTo'), { target: { value: '@Bob' } });
    fireEvent.change(screen.getByLabelText(/percentLabel/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() =>
      expect(mocks.sign).toHaveBeenCalledWith({
        operations: [
          [
            'set_withdraw_vesting_route',
            { from_account: 'Alice', to_account: 'bob', percent: 1000, auto_vest: false },
          ],
        ],
        accountName: 'alice',
        role: 'active',
      })
    );
  });

  it('a user cancel is a quiet no-op (no error, no broadcast)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    renderForm(vaultStore('alice'), 'Alice');
    await screen.findByText('addRoute');

    fireEvent.change(screen.getByLabelText('routeTo'), { target: { value: '@Bob' } });
    fireEvent.change(screen.getByLabelText(/percentLabel/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    const { apiClient } = await import('@/lib/steem/client');
    expect(apiClient.broadcastSetWithdrawVestingRoute).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('needsClassicReauth surfaces the existing owner-copy error', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    renderForm(vaultStore('alice'), 'Alice');
    await screen.findByText('addRoute');

    fireEvent.change(screen.getByLabelText('routeTo'), { target: { value: '@Bob' } });
    fireEvent.change(screen.getByLabelText(/percentLabel/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('mustBeAccountOwner');
    const { apiClient } = await import('@/lib/steem/client');
    expect(apiClient.broadcastSetWithdrawVestingRoute).not.toHaveBeenCalled();
  });
});
