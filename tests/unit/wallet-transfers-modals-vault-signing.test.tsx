/**
 * WalletTransfersModals × vault identity sessions (A6-T2) — retiring the
 * embedded re-auth dead-end for the TRANSFER action only.
 *
 * A vault session signs transfers through the per-key password path inside
 * TransferForm, so the modal hands it the form directly. Every OTHER action
 * (delegate, power up/down, convert...) keeps the classic re-auth gate until
 * its caller migrates (T3/T4) — in Vault Mode those still reach the
 * `vaultUnsupported*` notice through the embedded LoginForm dispatcher.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { WalletTransfersModals } from '@/components/wallet/wallet-transfers-modals';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => ({
  params: { username: 'alice' } as Record<string, string | undefined>,
  search: { value: 'walletAction=transfer' },
  pathname: { value: '/@alice/transfers' },
  replace: vi.fn(),
  push: vi.fn(),
  auth: {
    value: { username: 'alice', isAuthenticated: true },
  },
  activeSigningKey: { value: null as string | null },
  markers: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
  useSearchParams: () => new URLSearchParams(mocks.search.value),
}));

vi.mock('@/i18n/routing', () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mocks.auth.value,
  useActiveSigningKey: () => mocks.activeSigningKey.value,
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => {
    mocks.markers.push('reauth-login-form');
    return <div data-testid="reauth-login-form" />;
  },
}));

vi.mock('@/components/wallet/transfer-form', () => ({
  TransferForm: () => {
    mocks.markers.push('transfer-form');
    return <div data-testid="transfer-form" />;
  },
}));

vi.mock('@/components/wallet/power-down-form', () => ({ PowerDownForm: () => null }));
vi.mock('@/components/wallet/cancel-power-down-handler', () => ({
  CancelPowerDownHandler: () => null,
}));
vi.mock('@/components/wallet/power-up-form', () => ({ PowerUpForm: () => null }));
vi.mock('@/components/wallet/delegate-form', () => ({ DelegateForm: () => null }));
vi.mock('@/components/wallet/withdraw-routes-form', () => ({ WithdrawRoutesForm: () => null }));
vi.mock('@/components/wallet/convert-sbd-form', () => ({ ConvertSbdForm: () => null }));

function vaultSessionStore() {
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
  store.dispatch(setVaultIdentity({ username: 'alice' }));
  return store;
}

function privateKeySessionStore(activeKey: string | null) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        username: 'alice',
        ownerKey: null,
        activeKey,
        postingKey: null,
        memoKey: null,
        privateKey: activeKey,
        publicKey: null,
        isAuthenticated: true,
        sessionKind: 'privateKey',
      } satisfies AuthState,
    },
  });
}

function renderModals(store: ReturnType<typeof vaultSessionStore>) {
  return render(
    <Provider store={store}>
      <WalletTransfersModals />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = { username: 'alice' };
  mocks.search = { value: 'walletAction=transfer' };
  mocks.pathname = { value: '/@alice/transfers' };
  mocks.auth.value = { username: 'alice', isAuthenticated: true };
  mocks.activeSigningKey.value = null;
  mocks.markers = [];
  localStorage.clear();
});

describe('WalletTransfersModals — transfer action re-auth routing (A6-T2)', () => {
  it('a vault identity session gets the transfer form directly (no re-auth dead-end)', async () => {
    renderModals(vaultSessionStore());

    await waitFor(() => expect(mocks.markers).toContain('transfer-form'));
    expect(mocks.markers).not.toContain('reauth-login-form');
    expect(screen.queryByTestId('reauth-login-form')).not.toBeInTheDocument();
  });

  it('a privateKey session WITHOUT an active/owner key keeps the classic re-auth gate', async () => {
    mocks.activeSigningKey.value = null;
    renderModals(privateKeySessionStore(null));

    await waitFor(() => expect(mocks.markers).toContain('reauth-login-form'));
    expect(mocks.markers).not.toContain('transfer-form');
  });

  it('a privateKey session WITH an active key gets the transfer form as before', async () => {
    mocks.activeSigningKey.value = '5J-test-active';
    renderModals(privateKeySessionStore('5J-test-active'));

    await waitFor(() => expect(mocks.markers).toContain('transfer-form'));
    expect(mocks.markers).not.toContain('reauth-login-form');
  });

  it('non-migrated actions keep the re-auth gate for vault sessions (delegate example)', async () => {
    mocks.search = { value: 'walletAction=delegate' };
    renderModals(vaultSessionStore());

    await waitFor(() => expect(mocks.markers).toContain('reauth-login-form'));
    expect(mocks.markers).not.toContain('transfer-form');
  });

  it('the legacy power_up URL mapping is NOT bypassed for vault sessions', async () => {
    mocks.search = { value: 'walletAction=transfer&type=power_up' };
    renderModals(vaultSessionStore());

    await waitFor(() => expect(mocks.markers).toContain('reauth-login-form'));
    expect(mocks.markers).not.toContain('transfer-form');
  });

  it('a vault session NOT matching the page account keeps the re-auth gate', async () => {
    // Page is /@bob but the session identity is alice: only the remembered
    // device username (bob) makes the page manageable. The bypass requires
    // sessionMatchesPage, so re-auth still gates.
    mocks.params = { username: 'bob' };
    mocks.pathname = { value: '/@bob/transfers' };
    localStorage.setItem('wallet:rememberedUsername', 'bob');
    renderModals(vaultSessionStore());

    await waitFor(() => expect(mocks.markers).toContain('reauth-login-form'));
    expect(mocks.markers).not.toContain('transfer-form');
  });
});
