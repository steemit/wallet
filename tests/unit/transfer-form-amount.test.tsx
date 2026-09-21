/**
 * TransferForm amount validation parity (G-14): the form must reject >3
 * decimal places explicitly (like the power-up form) instead of silently
 * rounding with toFixed(3) at broadcast time, and the balance check must
 * compare at the precision that will actually be sent — "1.0005" against a
 * "1.0005 STEEM" balance previously passed the check, then rounded UP to
 * "1.001 STEEM" on chain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState } from '@/lib/store/slices/auth';
import { TransferForm } from '@/components/wallet/transfer-form';

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useActiveSigningKey: () => '5J-test-active',
}));

const mockFetchAccounts = vi.fn();
vi.mock('@/lib/steem/accounts-client', () => ({
  fetchAccounts: (...args: unknown[]) => mockFetchAccounts(...args),
}));

const mocks = vi.hoisted(() => ({
  signToSavings: vi.fn(),
  signTransfer: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signTransferToSavings: (...args: unknown[]) => mocks.signToSavings(...args),
    signTransfer: (...args: unknown[]) => mocks.signTransfer(...args),
  },
  apiClient: {
    broadcastTransfer: (...args: unknown[]) => mocks.broadcast(...args),
  },
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: vi.fn(),
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

/** Sender balances served to the form's available-balance effect. */
function balancesApiResponse(steemBalance: string) {
  return {
    success: true,
    accounts: [
      {
        name: 'alice',
        balance: steemBalance,
        sbd_balance: '0.000 SBD',
        savings_balance: '0.000 STEEM',
        savings_sbd_balance: '0.000 SBD',
        memo_key: 'STM6TESTKEY',
      },
    ],
  };
}

async function renderSavingsForm(steemBalance: string) {
  mockFetchAccounts.mockResolvedValue(balancesApiResponse(steemBalance));
  render(
    <Provider store={makeStore('alice')}>
      <TransferForm variant="page" initialTransferType="savings" />
    </Provider>
  );
  // Wait for the balances effect to land: the available-balance hint only
  // renders once senderBalances is set.
  await screen.findByText('availableBalance');
}

async function setAmount(value: string) {
  fireEvent.change(await screen.findByLabelText('amount'), { target: { value } });
}

describe('TransferForm — amount validation parity (G-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags an amount that would round UP past the balance at broadcast precision', async () => {
    // 2.0006 passes the old raw comparison (<= 2.0009) but toFixed(3)
    // rounds it to 2.001 > balance → the check must compare at 3 decimals.
    await renderSavingsForm('2.0009 STEEM');
    await setAmount('2.0006');

    await waitFor(() => {
      expect(screen.getByText('errors.insufficient_funds')).toBeInTheDocument();
    });
  });

  it('rejects >3 decimal places at submit instead of silently rounding', async () => {
    await renderSavingsForm('5.000 STEEM');
    await setAmount('1.0004');

    // Dispatch submit directly: the amount input declares step="0.001" and
    // jsdom blocks click-submission for step-mismatched values, which would
    // test the browser instead of the handler.
    const form = (screen.getByLabelText('amount') as HTMLInputElement).form;
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByText('errors.precision_error')).toBeInTheDocument();
    });
    expect(mocks.signToSavings).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('keeps the valid-input path unchanged (signs and broadcasts 3-decimal amount)', async () => {
    mocks.signToSavings.mockResolvedValue({ id: 'tx' });
    mocks.broadcast.mockResolvedValue({ success: true });
    await renderSavingsForm('5.000 STEEM');
    await setAmount('1.001');

    fireEvent.click(screen.getByRole('button', { name: 'transferButton' }));

    await waitFor(() => {
      expect(mocks.signToSavings).toHaveBeenCalledWith(
        'alice',
        'alice',
        '1.001 STEEM',
        '',
        '5J-test-active'
      );
    });
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
  });

  it('direct transfer flow: validates recipient and broadcasts on success', async () => {
    mocks.signTransfer.mockResolvedValue({ id: 'tx' });
    mocks.broadcast.mockResolvedValue({ success: true });
    const onSuccess = vi.fn();
    mockFetchAccounts.mockResolvedValue(balancesApiResponse('5.000 STEEM'));
    render(
      <Provider store={makeStore('alice')}>
        <TransferForm
          variant="dialog"
          initialTransferType="transfer"
          initialAsset="STEEM"
          onSuccess={onSuccess}
        />
      </Provider>
    );

    fireEvent.change(await screen.findByLabelText('to'), { target: { value: 'bob' } });
    await setAmount('1.5');
    fireEvent.click(screen.getByRole('button', { name: 'transferButton' }));

    await waitFor(() => {
      expect(mocks.signTransfer).toHaveBeenCalledWith(
        'alice',
        'bob',
        '1.500 STEEM',
        '',
        '5J-test-active'
      );
    });
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('verified-exchange recipient: memo required, warnings acknowledged, then sends', async () => {
    mocks.signTransfer.mockResolvedValue({ id: 'tx' });
    mocks.broadcast.mockResolvedValue({ success: true });
    mockFetchAccounts.mockResolvedValue(balancesApiResponse('5.000 STEEM'));
    render(
      <Provider store={makeStore('alice')}>
        <TransferForm variant="dialog" initialTransferType="transfer" initialAsset="STEEM" />
      </Provider>
    );

    // 'bittrex' is on VERIFIED_EXCHANGE_LIST; the async check renders the alert.
    fireEvent.change(await screen.findByLabelText('to'), { target: { value: 'bittrex' } });
    await screen.findByText('exchangeAlertTitle');
    await setAmount('1.5');

    // No memo -> verified exchanges require one; submit is refused.
    fireEvent.click(screen.getByRole('button', { name: 'transferButton' }));
    expect(await screen.findByText('errors.verified_exchange_no_memo')).toBeInTheDocument();
    expect(mocks.signTransfer).not.toHaveBeenCalled();

    // Memo + acknowledging the exchange warnings unblocks the send.
    fireEvent.change(screen.getByLabelText('memo'), { target: { value: 'deposit-123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'transferButton' }));

    await waitFor(() => {
      expect(mocks.signTransfer).toHaveBeenCalledWith(
        'alice',
        'bittrex',
        '1.500 STEEM',
        'deposit-123',
        '5J-test-active'
      );
    });
  });
});
