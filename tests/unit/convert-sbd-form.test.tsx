/**
 * ConvertSbdForm owner-gate regression tests (review finding C-1).
 *
 * Reproduces the visible failure: the session user is stored canonically
 * lowercase ("alice") while the wallet page URL can carry another casing
 * ("/@Alice/transfers"). The form previously compared the two with raw ===,
 * so Convert was permanently disabled with no hint for the account owner.
 * The owner check must be case- and '@'-insensitive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState } from '@/lib/store/slices/auth';
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

const mockBroadcastConvert = vi.fn();
vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    getMedianHistoryPrice: vi.fn().mockResolvedValue({ base: '1.000 SBD', quote: '1.000 STEEM' }),
    getAccounts: vi
      .fn()
      .mockResolvedValue({ accounts: [{ name: 'alice', sbd_balance: '10.000 SBD' }] }),
    broadcastConvert: (...args: unknown[]) => mockBroadcastConvert(...args),
  },
  SteemSigner: { signConvert: vi.fn().mockResolvedValue({ signed: true }) },
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

describe('ConvertSbdForm — normalized owner check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables submit when the session user differs from the URL account only by case/@', async () => {
    render(
      <Provider store={makeStore('alice')}>
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
      <Provider store={makeStore('bob')}>
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
    mockBroadcastConvert.mockResolvedValueOnce({ success: false, error: 'rate limited' });
    render(
      <Provider store={makeStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('rate limited');
  });

  it('broadcasts with the canonical page account and reports success', async () => {
    mockBroadcastConvert.mockResolvedValueOnce({ success: true });
    const onSuccess = vi.fn();
    render(
      <Provider store={makeStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="Alice" isMyAccount onSuccess={onSuccess} />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('amountLabel'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'convertButton' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const [tx, sessionUser] = mockBroadcastConvert.mock.calls[0] as [unknown, string];
    expect(tx).toEqual({ signed: true });
    expect(sessionUser).toBe('alice');
  });

  it('shows the market-rate unavailable hint when the price feed fails', async () => {
    const { apiClient } = await import('@/lib/steem/client');
    vi.mocked(apiClient.getMedianHistoryPrice).mockResolvedValueOnce({ error: 'down' });
    render(
      <Provider store={makeStore('alice')}>
        <ConvertSbdForm variant="page" accountUsername="alice" isMyAccount />
      </Provider>
    );
    expect(await screen.findByText('priceUnavailable')).toBeInTheDocument();
  });
});
