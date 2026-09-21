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
import { ClaimRewardsBanner } from '@/components/wallet/claim-rewards-banner';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import type { WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signClaimRewardBalance: vi.fn().mockResolvedValue({ signed: 'tx' }),
  },
  apiClient: {
    broadcastClaimRewardBalance: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const signClaim = vi.mocked(SteemSigner.signClaimRewardBalance);
const broadcastClaim = vi.mocked(apiClient.broadcastClaimRewardBalance);

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

function makeStore(postingKey: string | null): ReturnType<typeof configureStore> {
  const preloaded: { auth: AuthState } = {
    auth: {
      username: 'alice',
      ownerKey: null,
      activeKey: null,
      postingKey,
      memoKey: null,
      privateKey: postingKey,
      publicKey: 'STM-test',
      isAuthenticated: true,
    },
  };
  return configureStore({ reducer: { auth: authReducer }, preloadedState: preloaded });
}

function renderBanner(
  props: Partial<Parameters<typeof ClaimRewardsBanner>[0]> = {},
  postingKey: string | null = '5J-test-posting-key'
) {
  const onClaimed = vi.fn();
  render(
    <Provider store={makeStore(postingKey)}>
      <ClaimRewardsBanner
        username="alice"
        balance={BALANCE}
        isMyAccount
        loading={false}
        onClaimed={onClaimed}
        {...props}
      />
    </Provider>
  );
  return { onClaimed };
}

describe('ClaimRewardsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const { container: c1 } = render(<Provider store={makeStore('k')}><ClaimRewardsBanner username="alice" balance={NO_REWARDS} isMyAccount loading={false} /></Provider>);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<Provider store={makeStore('k')}><ClaimRewardsBanner username="alice" balance={BALANCE} isMyAccount={false} loading={false} /></Provider>);
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

  it('disables the button and explains when the session has no posting key', () => {
    renderBanner({}, null);
    const button = screen.getByRole('button', { name: 'claimRewards' });
    expect(button).toBeDisabled();
    expect(screen.getByText('claimNeedPostingKey')).toBeInTheDocument();
  });
});
