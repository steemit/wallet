/**
 * ClaimRewardsBanner — "Redeem Rewards" wiring tests (review finding G-2).
 *
 * The button used to be dead (no onClick). These tests pin the full flow:
 * sign with the SESSION POSTING KEY (claim_reward_balance is posting
 * authority), broadcast via the relay route, fire the page's cache
 * invalidation hook on success, and surface relay failures inline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState } from '@/lib/store/slices/auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ClaimRewardsBanner } from '@/components/wallet/claim-rewards-banner';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import {
  REMEMBERED_POSTING_KEY_KEY,
  REMEMBERED_USERNAME_KEY,
} from '@/lib/auth/browser-storage';
import type { WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signClaimRewardBalance: vi.fn().mockResolvedValue({ signed: 'tx' }),
    verifyPrivateKey: vi.fn(),
  },
  apiClient: {
    broadcastClaimRewardBalance: vi.fn().mockResolvedValue({ success: true }),
    getAccounts: vi.fn(),
  },
}));

const signClaim = vi.mocked(SteemSigner.signClaimRewardBalance);
const broadcastClaim = vi.mocked(apiClient.broadcastClaimRewardBalance);
const getAccountsMock = vi.mocked(apiClient.getAccounts);
const verifyPrivateKeyMock = vi.mocked(SteemSigner.verifyPrivateKey);

// The re-auth dialog embeds LoginForm, which pulls next-intl's app-router
// integration; the key-as-string useTranslations mock above already replaces
// the messages layer, so only the router hooks need stubbing.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test/transfers',
}));

// jsdom lacks ResizeObserver, required by radix-ui's Tooltip inside the
// embedded login form (same stub as login-form-reauth.test.tsx).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const BALANCE: WalletBalanceData = {
  balance: '10.000 STEEM',
  sbd_balance: '2.000 SBD',
  vesting_shares: '1000.000000 VESTS',
  delegated_vesting_shares: '0.000000 VESTS',
  received_vesting_shares: '0.000000 VESTS',
  vesting_withdraw_rate: '0.000000 VESTS',
  savings_balance: '0.000 STEEM',
  savings_sbd_balance: '0.000 SBD',
  next_vesting_withdrawal: '1970-01-01T00:00:00',
  to_withdraw: 0,
  withdrawn: 0,
  // Full pending amounts exactly as the account reports them (legacy parity:
  // zero-valued SBD included; the op claims all three token types).
  reward_steem_balance: '0.500 STEEM',
  reward_sbd_balance: '0.000 SBD',
  reward_vesting_steem: '2.000 STEEM',
  reward_vesting_balance: '9.876543 VESTS',
};

const NO_REWARDS: WalletBalanceData = {
  ...BALANCE,
  reward_steem_balance: '0.000 STEEM',
  reward_sbd_balance: '0.000 SBD',
  reward_vesting_steem: '0.000 STEEM',
  reward_vesting_balance: '0.000000 VESTS',
};

type SessionKeys = {
  postingKey?: string | null;
  activeKey?: string | null;
  ownerKey?: string | null;
};

function makeStore(keys: SessionKeys) {
  const { postingKey = null, activeKey = null, ownerKey = null } = keys;
  const preloaded: { auth: AuthState } = {
    auth: {
      username: 'alice',
      ownerKey,
      activeKey,
      postingKey,
      memoKey: null,
      privateKey: postingKey ?? activeKey ?? ownerKey,
      publicKey: 'STM-test',
      isAuthenticated: true,
    },
  };
  return configureStore({ reducer: { auth: authReducer }, preloadedState: preloaded });
}

function renderBanner(
  props: Partial<Parameters<typeof ClaimRewardsBanner>[0]> = {},
  keys: SessionKeys | string | null = { postingKey: '5J-test-posting-key' }
) {
  const sessionKeys: SessionKeys =
    keys === null ? { postingKey: null } : typeof keys === 'string' ? { postingKey: keys } : keys;
  const onClaimed = vi.fn();
  render(
    <Provider store={makeStore(sessionKeys)}>
      <TooltipProvider>
        <ClaimRewardsBanner
          username="alice"
          balance={BALANCE}
          isMyAccount
          loading={false}
          onClaimed={onClaimed}
          {...props}
        />
      </TooltipProvider>
    </Provider>
  );
  return { onClaimed };
}

describe('ClaimRewardsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Node 22's jsdom-less localStorage needs --localstorage-file; use the
    // explicit window storage or drop entries individually when absent.
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    signClaim.mockResolvedValue({ signed: 'tx' } as never);
    broadcastClaim.mockResolvedValue({ success: true });
  });

  it('renders the rewards string for the owner with pending rewards', () => {
    renderBanner();
    expect(screen.getByText(/Your current rewards:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'claimRewards' })).toBeEnabled();
    // Zero-valued SBD is omitted from the display string (legacy parity).
    expect(screen.getByText(/0\.500 STEEM and 2\.000 SP/)).toBeInTheDocument();
  });

  it('renders nothing without pending rewards or for another account', () => {
    const { container: c1 } = render(<Provider store={makeStore({ postingKey: 'k' })}><ClaimRewardsBanner username="alice" balance={NO_REWARDS} isMyAccount loading={false} /></Provider>);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<Provider store={makeStore({ postingKey: 'k' })}><ClaimRewardsBanner username="alice" balance={BALANCE} isMyAccount={false} loading={false} /></Provider>);
    expect(c2).toBeEmptyDOMElement();
  });

  it('signs with the posting key and the full pending amounts, then broadcasts and refreshes', async () => {
    const { onClaimed } = renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-test-posting-key'
    );
    expect(broadcastClaim).toHaveBeenCalledWith({ signed: 'tx' }, 'alice');
    // Success path: page hook (L1 invalidation + nonce bump) fires and the
    // banner hides optimistically.
    expect(onClaimed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(/Your current rewards:/)).not.toBeInTheDocument());
  });

  it('shows the relay error inline and keeps the banner when broadcast fails', async () => {
    broadcastClaim.mockResolvedValue({ success: false, error: 'chain rejected' });
    const { onClaimed } = renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(screen.getByText('chain rejected')).toBeInTheDocument());
    expect(screen.getByText(/Your current rewards:/)).toBeInTheDocument();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('shows the thrown signing error inline', async () => {
    signClaim.mockRejectedValue(new Error('sign failed'));
    const { onClaimed } = renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(screen.getByText('sign failed')).toBeInTheDocument());
    expect(broadcastClaim).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('stays clickable without a posting key and opens the posting re-auth dialog (issue #363)', async () => {
    renderBanner({}, null);
    const button = screen.getByRole('button', { name: 'claimRewards' });
    // Legacy parity: the button is NEVER disabled for missing keys (#363).
    expect(button).toBeEnabled();
    expect(screen.getByText('claimNeedPostingKey')).toBeInTheDocument();

    // No remembered key in localStorage -> the posting re-auth dialog opens.
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // The embedded login form is locked to the banner's account.
    expect((screen.getByLabelText('username') as HTMLInputElement).value).toBe('alice');
  });

  it('restores the device-remembered posting key and claims without re-auth', async () => {
    // localStorage carries a posting key remembered for this account, and the
    // chain account confirms it matches the posting authority.
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-remembered-posting');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    getAccountsMock.mockResolvedValue({
      success: true,
      accounts: [
        {
          posting: {
            account_auths: [],
            key_auths: [['STM-valid-posting-pub', '1']],
            weight_threshold: 1,
          },
        } as never,
      ],
    });
    verifyPrivateKeyMock.mockReturnValue(true);

    renderBanner({}, null);
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-remembered-posting'
    );
    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    // No re-auth dialog in this path.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores a remembered key belonging to a different account', async () => {
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-other-account-key');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'bob');
    renderBanner({}, null);

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(signClaim).not.toHaveBeenCalled();
  });

  it('ignores a remembered key that no longer matches the posting authority', async () => {
    // Key rotation: the stored key fails the chain-authority verification.
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-rotated-away');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    getAccountsMock.mockResolvedValue({
      success: true,
      accounts: [
        {
          posting: {
            account_auths: [],
            key_auths: [['STM-current-posting-pub', '1']],
            weight_threshold: 1,
          },
        } as never,
      ],
    });
    verifyPrivateKeyMock.mockReturnValue(false);

    renderBanner({}, null);
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(signClaim).not.toHaveBeenCalled();
  });

  it('falls back to the session active key and claims directly (chain accepts it)', async () => {
    // Posting-class ops accept posting, active, or owner authority on chain
    // (steem transaction_util.hpp verify_authority fallback), so an
    // active-key session signs the claim without any re-auth.
    renderBanner({}, { activeKey: '5K-active-key' });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5K-active-key'
    );
    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The keyless hint is hidden: an active key can sign posting operations.
    expect(screen.queryByText('claimNeedPostingKey')).not.toBeInTheDocument();
  });

  it('falls back to the session owner key when no active key exists', async () => {
    renderBanner({}, { ownerKey: '5K-owner-key' });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5K-owner-key'
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prefers the posting key over the session active and owner keys', async () => {
    renderBanner({}, {
      postingKey: '5J-posting-key',
      activeKey: '5K-active-key',
      ownerKey: '5K-owner-key',
    });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-posting-key'
    );
  });

  it('prefers the verified remembered posting key over the session active key', async () => {
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-remembered-posting');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    getAccountsMock.mockResolvedValue({
      success: true,
      accounts: [
        {
          posting: {
            account_auths: [],
            key_auths: [['STM-valid-posting-pub', '1']],
            weight_threshold: 1,
          },
        } as never,
      ],
    });
    verifyPrivateKeyMock.mockReturnValue(true);

    renderBanner({}, { activeKey: '5K-active-key' });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-remembered-posting'
    );
  });

  it('falls through to the session active key when the remembered posting key fails verification', async () => {
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-rotated-away');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    getAccountsMock.mockResolvedValue({
      success: true,
      accounts: [
        {
          posting: {
            account_auths: [],
            key_auths: [['STM-current-posting-pub', '1']],
            weight_threshold: 1,
          },
        } as never,
      ],
    });
    verifyPrivateKeyMock.mockReturnValue(false);

    renderBanner({}, { activeKey: '5K-active-key' });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5K-active-key'
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
