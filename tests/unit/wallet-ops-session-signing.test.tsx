/**
 * Wallet-operation callers × useSessionSigning integration (A6-T3a) — the
 * five callers that had no dedicated suite before the migration, in all
 * three session shapes. The hook is mocked at its module boundary (its own
 * matrix lives in use-session-signing.test.tsx); these tests pin what each
 * CALLER does with each outcome:
 *   - privateKey session: submit is NOT blocked, the byte-identical
 *     operation tuple (exactly what the retired SteemSigner.* builder built)
 *     reaches the unified entry, and the broadcast follows on `signed`;
 *   - vault identity session (no Redux keys): the action is AVAILABLE (the
 *     pre-A6 delegate-form "Not authenticated" dead-end is gone), signing
 *     goes through the unified entry, `cancelled` is a silent no-op;
 *   - privateKey session missing its key: `needsClassicReauth` routes to the
 *     caller's existing re-auth surface (embedded LoginForm for the forms,
 *     the same quiet no-op / owner-copy the keyless state always had for the
 *     dialog-less callers).
 *
 * convert-sbd-form / withdraw-routes-form / delegations-section live in
 * their own suites; transfer-form is the A6-T2 pilot suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { DelegateForm } from '@/components/wallet/delegate-form';
import { PowerUpForm } from '@/components/wallet/power-up-form';
import { PowerDownForm } from '@/components/wallet/power-down-form';
import { CancelPowerDownHandler } from '@/components/wallet/cancel-power-down-handler';
import { SavingsWithdrawHistory } from '@/components/wallet/savings-withdraw-history';

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

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  markers: [] as string[],
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => {
    mocks.markers.push('reauth-login-form');
    return <div data-testid="reauth-login-form" />;
  },
}));

vi.mock('@/hooks/use-global-props', () => ({
  useGlobalProps: () => ({
    // 1 SP === 2 VESTS at these globals (200M VESTS / 100M STEEM).
    globalProps: {
      total_vesting_shares: '200000000.000000 VESTS',
      total_vesting_fund_steem: '100000000.000 STEEM',
    },
    loading: false,
    error: '',
  }),
}));

vi.mock('@/hooks/use-account-data', () => ({
  useAccountData: () => ({
    data: {
      name: 'alice',
      balance: '10.000 STEEM',
      vesting_shares: '100.000000 VESTS',
      delegated_vesting_shares: '0.000000 VESTS',
      to_withdraw: 0,
      withdrawn: 0,
    },
    refetch: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    broadcastDelegate: vi.fn().mockResolvedValue({ success: true }),
    broadcastTransfer: vi.fn().mockResolvedValue({ success: true }),
    broadcastPowerDown: vi.fn().mockResolvedValue({ success: true }),
    broadcastCancelTransferFromSavings: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: vi.fn(),
}));

const cachedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cache/client-fetch', () => ({
  cachedFetch: (...args: unknown[]) => cachedFetchMock(...args),
}));
vi.mock('@/lib/cache/client-cache', () => ({
  clientCache: { invalidate: vi.fn() },
}));

import { apiClient } from '@/lib/steem/client';

const broadcastDelegate = vi.mocked(apiClient.broadcastDelegate);
const broadcastTransfer = vi.mocked(apiClient.broadcastTransfer);
const broadcastPowerDown = vi.mocked(apiClient.broadcastPowerDown);
const broadcastCancelTransferFromSavings = vi.mocked(
  apiClient.broadcastCancelTransferFromSavings
);

const BASE_AUTH: AuthState = {
  username: null,
  ownerKey: null,
  activeKey: null,
  postingKey: null,
  memoKey: null,
  privateKey: null,
  publicKey: null,
  isAuthenticated: false,
  sessionKind: 'privateKey',
};

function privateKeyStore(username: string, withKey: boolean) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        ...BASE_AUTH,
        username,
        activeKey: withKey ? '5J-test-active-key' : null,
        privateKey: withKey ? '5J-test-active-key' : null,
        isAuthenticated: true,
      } satisfies AuthState,
    },
  });
}

function vaultStore(username = 'alice') {
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: BASE_AUTH } });
  store.dispatch(setVaultIdentity({ username }));
  return store;
}

function signedOutcome() {
  return {
    status: 'signed' as const,
    result: { signedTx: { signatures: ['SIG'], operations: [] } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sign.mockResolvedValue(signedOutcome());
  mocks.markers = [];
});

/* ───────── DelegateForm ───────── */

async function submitDelegate(store: ReturnType<typeof privateKeyStore>) {
  render(
    <Provider store={store}>
      <DelegateForm variant="page" />
    </Provider>
  );
  fireEvent.change(await screen.findByLabelText('delegateeUsername'), {
    target: { value: 'bob' },
  });
  fireEvent.change(screen.getByLabelText('spToDelegate'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'delegateButton' }));
}

describe('DelegateForm × session signing (A6-T3a)', () => {
  it('signs the byte-identical delegate tuple through the unified entry (privateKey with key)', async () => {
    await submitDelegate(privateKeyStore('alice', true));

    await waitFor(() => expect(broadcastDelegate).toHaveBeenCalledTimes(1));
    // 1 SP === 2 VESTS at the mocked globals — the exact string
    // SteemSigner.signDelegate produced (steemPowerToVestsAsset).
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        [
          'delegate_vesting_shares',
          { delegator: 'alice', delegatee: 'bob', vesting_shares: '2.000000 VESTS' },
        ],
      ],
      accountName: 'alice',
      role: 'active',
    });
  });

  it('vault identity session: the "Not authenticated" dead-end is GONE and it signs + broadcasts', async () => {
    await submitDelegate(vaultStore());

    await waitFor(() => expect(broadcastDelegate).toHaveBeenCalledTimes(1));
    // The pre-A6 gap: a keyless vault session hit a hard-coded
    // "Not authenticated" here. Now the flow signs and succeeds.
    expect(screen.queryByText('Not authenticated')).not.toBeInTheDocument();
    expect(screen.queryByText('notAuthenticated')).not.toBeInTheDocument();
  });

  it('a user cancel in the signing dialog is a silent no-op', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    await submitDelegate(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastDelegate).not.toHaveBeenCalled();
    expect(screen.queryByText('delegateError')).not.toBeInTheDocument();
  });

  it('needsClassicReauth opens the embedded classic re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    await submitDelegate(privateKeyStore('alice', false));

    await waitFor(() =>
      expect(screen.getByTestId('reauth-login-form')).toBeInTheDocument()
    );
    expect(broadcastDelegate).not.toHaveBeenCalled();
  });

  it('a typed error outcome surfaces the existing delegate error copy', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'error', code: 'unexpected' });
    await submitDelegate(vaultStore());

    await waitFor(() => expect(screen.getByText('delegateError')).toBeInTheDocument());
    expect(broadcastDelegate).not.toHaveBeenCalled();
  });
});

/* ───────── PowerUpForm ───────── */

async function submitPowerUp(store: ReturnType<typeof privateKeyStore>) {
  render(
    <Provider store={store}>
      <PowerUpForm variant="page" />
    </Provider>
  );
  fireEvent.change(await screen.findByLabelText('amount'), { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'powerUpButton' }));
}

describe('PowerUpForm × session signing (A6-T3a)', () => {
  it('signs the byte-identical transfer_to_vesting tuple and broadcasts on /transfer', async () => {
    await submitPowerUp(privateKeyStore('alice', true));

    await waitFor(() => expect(broadcastTransfer).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        ['transfer_to_vesting', { from: 'alice', to: 'alice', amount: '1.500 STEEM' }],
      ],
      accountName: 'alice',
      role: 'active',
    });
  });

  it('vault identity session signs without any Redux key', async () => {
    await submitPowerUp(vaultStore());

    await waitFor(() => expect(broadcastTransfer).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('notAuthenticated')).not.toBeInTheDocument();
  });

  it('a user cancel is a silent no-op', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    await submitPowerUp(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastTransfer).not.toHaveBeenCalled();
  });

  it('needsClassicReauth opens the embedded classic re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    await submitPowerUp(privateKeyStore('alice', false));

    await waitFor(() =>
      expect(screen.getByTestId('reauth-login-form')).toBeInTheDocument()
    );
    expect(broadcastTransfer).not.toHaveBeenCalled();
  });
});

/* ───────── PowerDownForm ───────── */

async function submitPowerDown(store: ReturnType<typeof privateKeyStore>) {
  render(
    <Provider store={store}>
      <PowerDownForm variant="page" />
    </Provider>
  );
  // The range slider carries aria-label "amount"; set 50 of max 100 vests.
  const slider = await screen.findByLabelText('amount');
  fireEvent.change(slider, { target: { value: '50' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'powerDownButton' })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole('button', { name: 'powerDownButton' }));
}

describe('PowerDownForm × session signing (A6-T3a)', () => {
  it('signs the byte-identical withdraw_vesting tuple and broadcasts', async () => {
    await submitPowerDown(privateKeyStore('alice', true));

    await waitFor(() => expect(broadcastPowerDown).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        ['withdraw_vesting', { account: 'alice', vesting_shares: '50.000000 VESTS' }],
      ],
      accountName: 'alice',
      role: 'active',
    });
  });

  it('vault identity session signs without any Redux key', async () => {
    await submitPowerDown(vaultStore());

    await waitFor(() => expect(broadcastPowerDown).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('notAuthenticated')).not.toBeInTheDocument();
  });

  it('a user cancel is a silent no-op (no error note)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    await submitPowerDown(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastPowerDown).not.toHaveBeenCalled();
    expect(screen.queryByText('powerDownError')).not.toBeInTheDocument();
  });

  it('needsClassicReauth opens the embedded classic re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    await submitPowerDown(privateKeyStore('alice', false));

    await waitFor(() =>
      expect(screen.getByTestId('reauth-login-form')).toBeInTheDocument()
    );
    expect(broadcastPowerDown).not.toHaveBeenCalled();
  });
});

/* ───────── CancelPowerDownHandler ───────── */

function renderCancelHandler(
  store: ReturnType<typeof privateKeyStore>,
  onSuccess: () => void,
  onCancel: () => void
) {
  return render(
    <Provider store={store}>
      <CancelPowerDownHandler onSuccess={onSuccess} onCancel={onCancel} />
    </Provider>
  );
}

describe('CancelPowerDownHandler × session signing (A6-T3a)', () => {
  it('signs the byte-identical zero-VESTS withdraw tuple on mount and broadcasts', async () => {
    const onSuccess = vi.fn();
    renderCancelHandler(privateKeyStore('alice', true), onSuccess, vi.fn());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        ['withdraw_vesting', { account: 'alice', vesting_shares: '0.000000 VESTS' }],
      ],
      accountName: 'alice',
      role: 'active',
    });
    expect(broadcastPowerDown).toHaveBeenCalledTimes(1);
  });

  it('vault identity session signs through the unified entry (no infinite loading)', async () => {
    const onSuccess = vi.fn();
    renderCancelHandler(vaultStore(), onSuccess, vi.fn());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it('a user cancel dismisses the flow quietly (onCancel, no broadcast, no error)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    const onCancel = vi.fn();
    renderCancelHandler(vaultStore(), vi.fn(), onCancel);

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(broadcastPowerDown).not.toHaveBeenCalled();
    expect(screen.queryByText('cancelError')).not.toBeInTheDocument();
  });

  it('needsClassicReauth dismisses the flow quietly (no infinite loading)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    const onCancel = vi.fn();
    renderCancelHandler(vaultStore(), vi.fn(), onCancel);

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('cancelError')).not.toBeInTheDocument();
  });
});

/* ───────── SavingsWithdrawHistory ───────── */

const WITHDRAWAL = {
  id: 1,
  requestId: 42,
  from: 'alice',
  to: 'alice',
  amount: '5.000 STEEM',
  memo: '',
  complete: '2026-01-01T00:00:00',
};

async function openAndConfirmCancel(store: ReturnType<typeof privateKeyStore>) {
  cachedFetchMock.mockResolvedValue({
    data: { success: true, savingsWithdrawals: [WITHDRAWAL] },
  });
  render(
    <Provider store={store}>
      <SavingsWithdrawHistory username="alice" />
    </Provider>
  );
  fireEvent.click(await screen.findByText('(cancel)'));
  fireEvent.click(await screen.findByRole('button', { name: 'cancelConfirm' }));
}

describe('SavingsWithdrawHistory × session signing (A6-T3a)', () => {
  it('signs the byte-identical cancel_transfer_from_savings tuple and broadcasts', async () => {
    await openAndConfirmCancel(privateKeyStore('alice', true));

    await waitFor(() =>
      expect(broadcastCancelTransferFromSavings).toHaveBeenCalledTimes(1)
    );
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        ['cancel_transfer_from_savings', { from: 'alice', request_id: 42 }],
      ],
      accountName: 'alice',
      role: 'active',
    });
  });

  it('vault identity session: the cancel button is ENABLED without a Redux key', async () => {
    await openAndConfirmCancel(vaultStore());

    await waitFor(() =>
      expect(broadcastCancelTransferFromSavings).toHaveBeenCalledTimes(1)
    );
  });

  it('a user cancel is the quiet no-op a keyless session always had', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    await openAndConfirmCancel(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastCancelTransferFromSavings).not.toHaveBeenCalled();
    expect(screen.queryByText('cancelFailed')).not.toBeInTheDocument();
  });

  it('needsClassicReauth is the same quiet no-op (no error copy)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    await openAndConfirmCancel(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('cancelFailed')).not.toBeInTheDocument();
  });
});
