/**
 * WalletTransfersModals × vault identity sessions (A6-T2 pilot, A6-T3a all
 * actions) — retiring the embedded re-auth dead-end for EVERY wallet action.
 *
 * A vault session signs every action this modal hosts (transfer, power up,
 * power down, cancel power down, delegate, withdraw routes, convert) through
 * the per-key password path inside its form, so the modal hands it the form
 * directly. A vault session NOT matching the page account — and a
 * privateKey session without an active/owner key — keep the classic re-auth
 * gate.
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

vi.mock('@/components/wallet/power-down-form', () => ({
  PowerDownForm: () => {
    mocks.markers.push('power-down-form');
    return <div data-testid="power-down-form" />;
  },
}));
vi.mock('@/components/wallet/cancel-power-down-handler', () => ({
  CancelPowerDownHandler: () => {
    mocks.markers.push('cancel-power-down-handler');
    return <div data-testid="cancel-power-down-handler" />;
  },
}));
vi.mock('@/components/wallet/power-up-form', () => ({
  PowerUpForm: () => {
    mocks.markers.push('power-up-form');
    return <div data-testid="power-up-form" />;
  },
}));
vi.mock('@/components/wallet/delegate-form', () => ({
  DelegateForm: () => {
    mocks.markers.push('delegate-form');
    return <div data-testid="delegate-form" />;
  },
}));
vi.mock('@/components/wallet/withdraw-routes-form', () => ({
  WithdrawRoutesForm: () => {
    mocks.markers.push('withdraw-routes-form');
    return <div data-testid="withdraw-routes-form" />;
  },
}));
vi.mock('@/components/wallet/convert-sbd-form', () => ({
  ConvertSbdForm: () => {
    mocks.markers.push('convert-sbd-form');
    return <div data-testid="convert-sbd-form" />;
  },
}));

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

describe('WalletTransfersModals — vault-session re-auth routing (A6-T2/T3a)', () => {
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

  it.each([
    ['delegate', 'delegate-form'],
    ['powerUp', 'power-up-form'],
    ['powerDown', 'power-down-form'],
    ['cancelPowerDown', 'cancel-power-down-handler'],
    ['advanced', 'withdraw-routes-form'],
    ['convert', 'convert-sbd-form'],
  ])(
    'a vault identity session gets the %s form directly (A6-T3a migration)',
    async (action, marker) => {
      mocks.search = { value: `walletAction=${action}` };
      renderModals(vaultSessionStore());

      await waitFor(() => expect(mocks.markers).toContain(marker));
      expect(mocks.markers).not.toContain('reauth-login-form');
    },
  );

  it('the legacy power_up URL mapping is bypassed for vault sessions too (power up migrated)', async () => {
    mocks.search = { value: 'walletAction=transfer&type=power_up' };
    renderModals(vaultSessionStore());

    await waitFor(() => expect(mocks.markers).toContain('power-up-form'));
    expect(mocks.markers).not.toContain('reauth-login-form');
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
