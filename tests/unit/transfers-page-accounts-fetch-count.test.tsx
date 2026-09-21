/**
 * Transfers-page accounts fetch count (finding G-13).
 *
 * /api/query/accounts used to have six call sites with four caching
 * strategies; one /@alice/transfers mount fired three identical requests
 * (balances hook cachedFetch 10s/60s, recovery banner cachedFetch 30s/120s,
 * profile banner raw no-store fetch). After the consolidation every consumer
 * goes through fetchAccounts (shared L1 entry + in-flight dedup), so the
 * whole mount must issue exactly ONE accounts request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import WalletPage from '@/app/[locale]/[username]/page';
import authReducer from '@/lib/store/slices/auth';
import { clientCache } from '@/lib/cache/client-cache';
import { clearInFlightAccountRequests } from '@/lib/steem/accounts-client';

const mocks = vi.hoisted(() => ({
  auth: { username: 'alice', isAuthenticated: true },
  params: { username: 'alice' },
  pathname: { value: '/@alice/transfers' },
  push: vi.fn(),
  replace: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
}));

vi.mock('@/i18n/routing', () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

// RecoveryWarningBanner renders copy through next-intl; key echo is enough.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Components that fetch OTHER endpoints (history, extras, prices) or none —
// mocked so the only accounts consumers left real are: the page's profile
// banner effect, useSteemWalletBalances, and RecoveryWarningBanner.
vi.mock('@/components/wallet/client-wrappers', () => ({
  RecentActivityLazy: () => null,
  AuthorRewardsSectionLazy: () => null,
  AccountSettingsSectionLazy: () => null,
  CurationRewardsSectionLazy: () => null,
  DelegationsSectionLazy: () => null,
}));
vi.mock('@/components/wallet/balance-rows', () => ({
  BalanceRows: () => null,
}));
vi.mock('@/components/wallet/claim-rewards-banner', () => ({
  ClaimRewardsBanner: () => null,
}));
vi.mock('@/components/wallet/savings-withdraw-history', () => ({
  SavingsWithdrawHistory: () => null,
}));
vi.mock('@/components/wallet/advanced-routes-notice', () => ({
  AdvancedRoutesNotice: () => null,
}));
vi.mock('@/components/layout/user-profile-banner', () => ({
  UserProfileBanner: () => null,
}));
vi.mock('@/components/layout/account-wallet-nav', () => ({
  AccountWalletNav: () => null,
}));
vi.mock('@/components/wallet/wallet-transfers-modals', () => ({
  WalletTransfersModals: () => null,
}));

function accountsUrlOf(call: unknown[]): string | null {
  const url = typeof call[0] === 'string' ? call[0] : String(call[0]);
  return url.includes('/api/query/accounts') ? url : null;
}

describe('transfers page mount — accounts fetch count (G-13)', () => {
  let store: ReturnType<typeof configureStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    clientCache.clear();
    clearInFlightAccountRequests();
    store = configureStore({ reducer: { auth: authReducer } });
    store.dispatch({
      type: 'auth/setCredentials',
      payload: { username: 'alice', privateKey: 'k', publicKey: 'pub' },
    });
    mocks.auth.username = 'alice';
    mocks.auth.isAuthenticated = true;
    mocks.pathname.value = '/@alice/transfers';

    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/query/accounts')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            accounts: [
              {
                name: 'alice',
                created: '2016-01-01',
                balance: '1.000 STEEM',
                sbd_balance: '0.000 SBD',
              },
            ],
          }),
          headers: new Headers(),
        } as unknown as Response);
      }
      if (url.includes('/api/query/global-props')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            props: { total_vesting_shares: '1 VESTS', total_vesting_fund_steem: '1 STEEM' },
          }),
          headers: new Headers(),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
        headers: new Headers(),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('a transfers mount issues exactly one /api/query/accounts request', async () => {
    render(
      <Provider store={store}>
        <WalletPage />
      </Provider>
    );

    await waitFor(() => {
      const accountsCalls = mocks.fetch.mock.calls.map(accountsUrlOf).filter(Boolean);
      expect(accountsCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Let every pending effect/microtask settle before counting.
    await new Promise((r) => setTimeout(r, 50));

    const accountsCalls = mocks.fetch.mock.calls.map(accountsUrlOf).filter(Boolean);
    expect(accountsCalls).toEqual(['/api/query/accounts?names=alice']);
  });

  it('a second mount within the fresh window adds no further accounts request', async () => {
    const { unmount } = render(
      <Provider store={store}>
        <WalletPage />
      </Provider>
    );
    await waitFor(() => {
      expect(mocks.fetch.mock.calls.map(accountsUrlOf).filter(Boolean).length).toBeGreaterThanOrEqual(1);
    });
    unmount();

    render(
      <Provider store={store}>
        <WalletPage />
      </Provider>
    );
    await new Promise((r) => setTimeout(r, 50));

    const accountsCalls = mocks.fetch.mock.calls.map(accountsUrlOf).filter(Boolean);
    expect(accountsCalls).toEqual(['/api/query/accounts?names=alice']);
  });
});
