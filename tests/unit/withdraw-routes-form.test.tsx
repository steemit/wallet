/**
 * WithdrawRoutesForm owner-gate regression tests (review finding C-1).
 *
 * Reproduces the visible failure: session user "alice" (canonical, from
 * Redux) vs page URL account "Alice" (raw === comparison) made the routes
 * editor permanently read-only for the account owner. canEdit must compare
 * normalized account names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState } from '@/lib/store/slices/auth';
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

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getWithdrawRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    broadcastSetWithdrawVestingRoute: vi.fn().mockResolvedValue({ success: true }),
  },
  SteemSigner: { signSetWithdrawVestingRoute: vi.fn().mockResolvedValue({ signed: true }) },
}));

function makeStore(sessionUser: string): ReturnType<typeof configureStore> {
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

function renderForm(sessionUser: string, accountUsername: string) {
  return render(
    <Provider store={makeStore(sessionUser)}>
      <WithdrawRoutesForm variant="page" accountUsername={accountUsername} isMyAccount />
    </Provider>
  );
}

describe('WithdrawRoutesForm — normalized owner check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is editable when the session user differs from the URL account only by case', async () => {
    renderForm('alice', 'Alice');

    // Editable: the add-route form is present and the view-only hint is not.
    expect(await screen.findByText('addRoute')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('viewOnly')).not.toBeInTheDocument());
  });

  it('is read-only for a different account', async () => {
    renderForm('bob', 'Alice');

    expect(await screen.findByText('viewOnly')).toBeInTheDocument();
    expect(screen.queryByText('addRoute')).not.toBeInTheDocument();
  });

  it('lists existing routes and removes one for the owner', async () => {
    const { apiClient, SteemSigner } = await import('@/lib/steem/client');
    vi.mocked(apiClient.getWithdrawRoutes).mockResolvedValueOnce({
      routes: [{ to_account: 'bob', percent: 5000, auto_vest: true }],
    });
    renderForm('alice', 'Alice');

    expect(await screen.findByText('@bob')).toBeInTheDocument();
    expect(screen.getByText('50% — autoVestOn')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    await waitFor(() =>
      expect(SteemSigner.signSetWithdrawVestingRoute).toHaveBeenCalledWith(
        'Alice',
        'bob',
        0,
        false,
        '5J-test-active-key'
      )
    );
  });

  it('validates destination and percent before adding a route', async () => {
    renderForm('alice', 'Alice');
    await screen.findByText('addRoute');

    // Empty destination.
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('enterDestination');
  });

  it('adds a route for the owner with mixed-case page/session names', async () => {
    renderForm('alice', 'Alice');
    await screen.findByText('addRoute');

    fireEvent.change(screen.getByLabelText('routeTo'), { target: { value: '@Bob' } });
    fireEvent.change(screen.getByLabelText(/percentLabel/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    const { SteemSigner } = await import('@/lib/steem/client');
    await waitFor(() =>
      expect(SteemSigner.signSetWithdrawVestingRoute).toHaveBeenCalledWith(
        'Alice',
        'bob',
        2500,
        false,
        '5J-test-active-key'
      )
    );
  });
});
