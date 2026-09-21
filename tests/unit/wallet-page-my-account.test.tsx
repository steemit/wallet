/**
 * Wallet page isMyAccount regression test (review finding C-1).
 *
 * Reproduces the visible failure: log in as canonical lowercase "alice",
 * visit /@Alice/transfers. `showBalanceActions` compared normalized names
 * (true) while `isMyAccount` used raw === (false), forking the UI: the
 * balance dropdown was clickable but SavingsWithdrawHistory disappeared and
 * owner-only sections vanished. Both gates must agree on normalized names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import WalletPage from '@/app/[locale]/[username]/page';

const mocks = vi.hoisted(() => ({
  auth: { username: 'alice', isAuthenticated: true },
  params: { username: 'Alice' },
  pathname: { value: '/@Alice/transfers' },
  push: vi.fn(),
  replace: vi.fn(),
  fetch: vi.fn(),
}));

// Session auth (Redux): canonical lowercase username, authenticated.
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => mocks.auth,
}));

// URL: visitor typed /@Alice/transfers (mixed case).
vi.mock('next/navigation', () => ({
  useParams: () => mocks.params,
}));

vi.mock('@/i18n/routing', () => ({
  usePathname: () => mocks.pathname.value,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

// jsdom cannot fetch relative URLs; the banner effect calls this.
mocks.fetch.mockResolvedValue({
  ok: true,
  json: async () => ({
    success: true,
    accounts: [
      {
        name: 'alice',
        created: '2016-01-01',
        json_metadata: JSON.stringify({ profile: { name: 'Alice' } }),
      },
    ],
  }),
});
vi.stubGlobal('fetch', mocks.fetch);

vi.mock('@/hooks/use-steem-wallet-balances', () => ({
  useSteemWalletBalances: () => ({ balance: null, globalProps: null, loading: false }),
}));

const markers: string[] = [];
vi.mock('@/components/wallet/client-wrappers', () => ({
  RecentActivityLazy: () => {
    markers.push('recent-activity');
    return null;
  },
  AuthorRewardsSectionLazy: () => {
    markers.push('author-rewards');
    return null;
  },
  AccountSettingsSectionLazy: () => {
    markers.push('settings');
    return null;
  },
  CurationRewardsSectionLazy: () => {
    markers.push('curation-rewards');
    return null;
  },
  DelegationsSectionLazy: () => {
    markers.push('delegations');
    return null;
  },
}));

vi.mock('@/components/wallet/balance-rows', () => ({
  BalanceRows: () => {
    markers.push('balance-rows');
    return null;
  },
}));
vi.mock('@/components/wallet/claim-rewards-banner', () => ({
  ClaimRewardsBanner: () => null,
}));
vi.mock('@/components/wallet/recovery-warning-banner', () => ({
  RecoveryWarningBanner: () => null,
}));
vi.mock('@/components/wallet/savings-withdraw-history', () => ({
  SavingsWithdrawHistory: () => {
    markers.push('savings-withdraw');
    return null;
  },
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

describe('WalletPage — isMyAccount with URL case != session case', () => {
  beforeEach(() => {
    markers.length = 0;
    mocks.auth.username = 'alice';
    mocks.pathname.value = '/@Alice/transfers';
    mocks.replace.mockClear();
    mocks.push.mockClear();
    mocks.fetch.mockClear();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, accounts: [] }),
    });
  });

  it('treats /@Alice as MY account when logged in as alice (no UI fork)', async () => {
    render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('balance-rows'));
    expect(markers).toContain('savings-withdraw');
    expect(markers).toContain('recent-activity');
  });

  it('hides owner-only sections for another account', async () => {
    mocks.auth.username = 'bob';
    render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('balance-rows'));
    expect(markers).not.toContain('savings-withdraw');
  });

  it('redirects a bare /@Alice profile URL to the canonical transfers path', async () => {
    mocks.pathname.value = '/@Alice';
    render(<WalletPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/@alice/transfers'));
  });

  it('renders the delegations sub-page for the owner', async () => {
    mocks.pathname.value = '/@Alice/delegations';
    render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('delegations'));
    expect(markers).not.toContain('balance-rows');
  });

  it('renders settings, curation-rewards and author-rewards sub-pages', async () => {
    mocks.pathname.value = '/@Alice/settings';
    const { unmount } = render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('settings'));
    unmount();

    markers.length = 0;
    mocks.pathname.value = '/@Alice/curation-rewards';
    const { unmount: u2 } = render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('curation-rewards'));
    u2();

    markers.length = 0;
    mocks.pathname.value = '/@Alice/author-rewards';
    render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('author-rewards'));
  });

  it('queries the accounts API with the normalized name for the profile banner', async () => {
    render(<WalletPage />);
    await waitFor(() =>
      expect(mocks.fetch).toHaveBeenCalledWith('/api/query/accounts?names=alice', {
        cache: 'no-store',
      })
    );
  });

  it('falls back to an empty banner when the profile fetch fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    render(<WalletPage />);
    await waitFor(() => expect(markers).toContain('balance-rows'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
