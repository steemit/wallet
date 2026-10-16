import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState, setCredentials } from '@/lib/store/slices/auth';
import { ClaimRewardsBanner } from '@/components/wallet/claim-rewards-banner';
import { SteemSigner } from '@/lib/steem/client';
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

// Stub the embedded login form: these tests drive the banner's post-login
// gate directly via onLoginSuccess, controlling the Redux session themselves.
vi.mock('@/components/auth/login-form', () => ({
  LoginForm: ({ onLoginSuccess }: { onLoginSuccess?: () => void }) => (
    <button type="button" data-testid="complete-login" onClick={() => onLoginSuccess?.()}>
      complete-login
    </button>
  ),
}));

const signClaim = vi.mocked(SteemSigner.signClaimRewardBalance);

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
  reward_steem_balance: '0.500 STEEM',
  reward_sbd_balance: '0.000 SBD',
  reward_vesting_steem: '2.000 STEEM',
  reward_vesting_balance: '9.876543 VESTS',
};

function makeStore(postingKey: string | null) {
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

function renderBanner(postingKey: string | null = null) {
  const store = makeStore(postingKey);
  const onClaimed = vi.fn();
  render(
    <Provider store={store}>
      <ClaimRewardsBanner
        username="alice"
        balance={BALANCE}
        isMyAccount
        loading={false}
        onClaimed={onClaimed}
      />
    </Provider>
  );
  return { store, onClaimed };
}

describe('ClaimRewardsBanner post-login authority gate (issue #363)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    signClaim.mockResolvedValue({ signed: 'tx' } as never);
  });

  it('keeps the dialog open with explicit guidance when the login carries no posting key', async () => {
    // An active/owner-only login passes LoginForm's hierarchical authority
    // gate but cannot sign claim_reward_balance — the banner must not close
    // the dialog into a silent loop.
    const { store } = renderBanner(null);
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Simulate a successful active-only login: session gains an active key,
    // still no posting key.
    act(() => {
      store.dispatch(setCredentials({ username: 'alice', activeKey: '5K-active-only' }));
    });
    fireEvent.click(screen.getByTestId('complete-login'));

    // Dialog stays open, the error names the required keys, nothing signed.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('claimNeedPostingKey');
    expect(signClaim).not.toHaveBeenCalled();
  });

  it('closes the dialog when the login carries a posting key, and the next click claims', async () => {
    const { store } = renderBanner(null);
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    act(() => {
      store.dispatch(setCredentials({ username: 'alice', postingKey: '5J-fresh-posting' }));
    });
    fireEvent.click(screen.getByTestId('complete-login'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-fresh-posting'
    );
  });

  it('signs only once on a rapid double-click', async () => {
    renderBanner('5J-test-posting-key');
    const button = screen.getByRole('button', { name: 'claimRewards' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
  });
});
