/**
 * ConvertSbdForm owner-gate regression tests (review finding C-1) plus the
 * A6-T3a session-signing integration.
 *
 * Reproduces the visible failure: the session user is stored canonically
 * lowercase ("alice") while the wallet page URL can carry another casing
 * ("/@Alice/transfers"). The form previously compared the two with raw ===,
 * so Convert was permanently disabled with no hint for the account owner.
 * The owner check must be case- and '@'-insensitive.
 *
 * Since A6-T3a the form signs through the unified session signing entry
 * (`useSessionSigning`, mocked at its module boundary): privateKey sessions
 * sign through the facade's legacy backend, vault identity sessions through
 * the per-key password dialog — and a vault session no longer counts as
 * "no key" for the submit gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { ConvertSbdForm } from '@/components/wallet/convert-sbd-form';

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
  broadcastConvert: vi.fn(),
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getMedianHistoryPrice: vi.fn().mockResolvedValue({ base: '1.000 SBD', quote: '1.000 STEEM' }),
    getAccounts: vi
      .fn()
      .mockResolvedValue({ accounts: [{ name: 'alice', sbd_balance: '10.000 SBD' }] }),
    broadcastConvert: (...args: unknown[]) => mocks.broadcastConvert(...args),
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

describe('ConvertSbdForm — normalized owner check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue(signedOutcome());
  });

  it('enables submit when the session user differs from the URL account only by case/@', async () => {
    render(
      <Provider store={privateKeyStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount />
      </Provider>
    );

    const amount = await screen.findByLabelText('amountLabel');
    fireEvent.change(amount, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => {
      const submit = screen.getByRole('button', { name: 'convertButton' }) as HTMLButtonElement;
      expect(submit.disabled).toBe(false);
    });
  });

  it('keeps submit disabled for a different account', async () => {
    render(
      <Provider store={privateKeyStore('bob')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount />
      </Provider>
    );

    const amount = await screen.findByLabelText('amountLabel');
    fireEvent.change(amount, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox'));

    const submit = screen.getByRole('button', { name: 'convertButton' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('surfaces broadcast failures from the relay', async () => {
    mocks.broadcastConvert.mockResolvedValueOnce({ success: false, error: 'rate limited' });
    render(
      <Provider store={privateKeyStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rate limited');
  });

  it('signs the byte-identical convert tuple and broadcasts with the session user', async () => {
    mocks.broadcastConvert.mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    render(
      <Provider store={privateKeyStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount onSuccess={onSuccess} />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // Byte-identical to what SteemSigner.signConvert built before A6-T3a
    // (requestid stays Math.floor(Date.now() / 1000)).
    await waitFor(() =>
      expect(mocks.sign).toHaveBeenCalledWith({
        operations: [
          [
            'convert',
            {
              owner: 'Alice',
              requestid: expect.any(Number),
              amount: '2.000 SBD',
            },
          ],
        ],
        accountName: 'alice',
        role: 'active',
      })
    );
    const [tx, sessionUser] = mocks.broadcastConvert.mock.calls[0] as [unknown, string];
    expect(tx).toEqual(signedOutcome().result.signedTx);
    expect(sessionUser).toBe('alice');
  });

  it('shows the market-rate unavailable hint when the price feed fails', async () => {
    const { apiClient } = await import('@/lib/steem/client');
    vi.mocked(apiClient.getMedianHistoryPrice).mockResolvedValueOnce({ error: 'down' });
    render(
      <Provider store={privateKeyStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="alice" isMyAccount />
      </Provider>
    );
    expect(await screen.findByText('priceUnavailable')).toBeInTheDocument();
  });
});

describe('ConvertSbdForm — vault identity session (A6-T3a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sign.mockResolvedValue(signedOutcome());
  });

  it('submit is NOT disabled by the missing Redux key; signs and broadcasts', async () => {
    mocks.broadcastConvert.mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    render(
      <Provider store={vaultStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="alice" isMyAccount onSuccess={onSuccess} />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('checkbox'));

    const submit = screen.getByRole('button', { name: 'convertButton' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        ['convert', { owner: 'alice', requestid: expect.any(Number), amount: '3.000 SBD' }],
      ],
      accountName: 'alice',
      role: 'active',
    });
    expect(mocks.broadcastConvert).toHaveBeenCalledTimes(1);
  });

  it('a user cancel is a quiet no-op (no error, no broadcast)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    render(
      <Provider store={vaultStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="alice" isMyAccount />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(mocks.broadcastConvert).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('needsClassicReauth surfaces the existing owner-copy error (privateKey without a key)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    render(
      <Provider store={vaultStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="alice" isMyAccount />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('mustBeAccountOwner');
    expect(mocks.broadcastConvert).not.toHaveBeenCalled();
  });
});
