/**
 * ClaimRewardsBanner — "Redeem Rewards" wiring tests (review finding G-2).
 *
 * The button used to be dead (no onClick). These tests pin the full flow:
 * sign claim_reward_balance (posting authority — the full pending amounts of
 * all three token types), broadcast via the relay route, fire the page's
 * cache invalidation hook on success, and surface relay failures inline.
 *
 * Since A6-T3b the SESSION-key cases sign through the unified session
 * signing entry (`useSessionSigning`, mocked at its module boundary — its
 * own routing matrix lives in use-session-signing.test.tsx): privateKey
 * sessions get role floor 'posting' (the hook resolves posting -> active ->
 * owner, the #378 session-key chain), vault identity sessions the per-key
 * password dialog. The device-remembered posting-key restore (#375/#378)
 * stays a privateKey-session affordance that signs DIRECTLY with the
 * restored key — pinned here, including the invariant-21 rule that a vault
 * session never reads it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { AuthState, setVaultIdentity } from '@/lib/store/slices/auth';
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

const mocks = vi.hoisted(() => ({ sign: vi.fn() }));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
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

/** The exact tuple the banner must hand the unified entry (posting floor). */
const CLAIM_REQUEST = {
  operations: [
    [
      'claim_reward_balance',
      {
        account: 'alice',
        reward_steem: '0.500 STEEM',
        reward_sbd: '0.000 SBD',
        reward_vests: '9.876543 VESTS',
      },
    ],
  ],
  accountName: 'alice',
  role: 'posting',
};

type SessionKeys = {
  postingKey?: string | null;
  activeKey?: string | null;
  ownerKey?: string | null;
  /** Build a Vault Mode identity session (R3) instead of a privateKey one. */
  vaultSession?: boolean;
};

function makeStore(keys: SessionKeys) {
  const { postingKey = null, activeKey = null, ownerKey = null, vaultSession = false } = keys;
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
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: preloaded });
  if (vaultSession) {
    // Through the real reducer: sessionKind 'vault' with ALL six key fields
    // forced to null, exactly what VaultLoginForm's identity selection leaves.
    store.dispatch(setVaultIdentity({ username: 'alice' }));
  }
  return store;
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

const signedOutcome = () => ({
  status: 'signed' as const,
  result: { signedTx: { signed: 'tx' } },
});

describe('ClaimRewardsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Node 22's jsdom-less localStorage needs --localstorage-file; use the
    // explicit window storage or drop entries individually when absent.
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    window.localStorage.clear();
    signClaim.mockResolvedValue({ signed: 'tx' } as never);
    broadcastClaim.mockResolvedValue({ success: true });
    mocks.sign.mockResolvedValue(signedOutcome());
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

  it('sends the full-pending-amounts tuple to the unified entry at the posting floor, then broadcasts and refreshes', async () => {
    const { onClaimed } = renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    // Byte-identical to what SteemSigner.signClaimRewardBalance built, with
    // the posting role floor (posting-class op, #378 chain).
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.sign).toHaveBeenCalledWith(CLAIM_REQUEST);
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

  it('a typed signing error outcome shows the localized claim error and never broadcasts', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'error', code: 'unexpected' });
    const { onClaimed } = renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(screen.getByText('claimFailed')).toBeInTheDocument());
    expect(broadcastClaim).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('stays clickable without a posting key and opens the posting re-auth dialog (issue #363)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    renderBanner({}, null);
    const button = screen.getByRole('button', { name: 'claimRewards' });
    // Legacy parity: the button is NEVER disabled for missing keys (#363).
    expect(button).toBeEnabled();
    expect(screen.getByText('claimNeedPostingKey')).toBeInTheDocument();

    // No remembered key in localStorage -> the unified entry reports
    // needsClassicReauth -> the posting re-auth dialog opens.
    fireEvent.click(button);
    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
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

    // The remembered-key affordance signs DIRECTLY with the restored key
    // (pre-A6 path preserved — the key lives in device storage, in no
    // session the unified entry could read).
    await waitFor(() => expect(signClaim).toHaveBeenCalledTimes(1));
    expect(signClaim).toHaveBeenCalledWith(
      'alice',
      '0.500 STEEM',
      '0.000 SBD',
      '9.876543 VESTS',
      '5J-remembered-posting'
    );
    expect(mocks.sign).not.toHaveBeenCalled();
    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    // No re-auth dialog in this path.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never touches the Legacy remembered posting key in a vault session (invariant 21)', async () => {
    // Same happy-path storage as the privateKey control case 'restores the
    // device-remembered posting key and claims without re-auth' above — a
    // chain-verifiable posting key remembered for THIS account — but under a
    // keyless VAULT session (sessionKind 'vault', all six key fields null).
    // The banner must not read the Legacy storage or direct-sign anything;
    // the claim routes through the unified entry, which answers a vault
    // session with the per-key password dialog (never the classic re-auth
    // dialog / its Vault Mode notice — that chain retired in A6-T3b).
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

    // Node >= 22.4 ships its own Storage global, so spy on the prototype of
    // jsdom's actual localStorage instance (09-vault.md Pitfalls).
    const storageProto = Object.getPrototypeOf(window.localStorage) as Storage;
    const getItemSpy = vi.spyOn(storageProto, 'getItem');
    // A vault session's sign() promise stays pending while the (mocked-out)
    // password dialog is open — mirror that so the terminal assertions below
    // run against the open-dialog state, not a settled outcome.
    mocks.sign.mockReturnValue(new Promise(() => {}));
    try {
      renderBanner({}, { vaultSession: true });
      // A vault session signs: the keyless hint is hidden (dialog path).
      expect(screen.queryByText('claimNeedPostingKey')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

      // The request reached the unified entry (which opens the password
      // dialog for a vault session in production).
      await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
      expect(mocks.sign).toHaveBeenCalledWith(CLAIM_REQUEST);
      // The Legacy remembered posting key was never read...
      expect(
        getItemSpy.mock.calls.filter(([k]) => k === REMEMBERED_POSTING_KEY_KEY)
      ).toHaveLength(0);
      // ...no chain fetch, no direct signing, no relay...
      expect(getAccountsMock).not.toHaveBeenCalled();
      expect(signClaim).not.toHaveBeenCalled();
      expect(broadcastClaim).not.toHaveBeenCalled();
      // ...and NO classic re-auth dialog appears (the pre-A6 vault flow
      // opened it only to hit the Vault Mode unsupported notice).
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByTestId('vault-mode-unsupported')).toBeNull();
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it('ignores a remembered key belonging to a different account', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    window.localStorage.setItem(REMEMBERED_POSTING_KEY_KEY, '5J-other-account-key');
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'bob');
    renderBanner({}, null);

    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(signClaim).not.toHaveBeenCalled();
  });

  it('ignores a remembered key that no longer matches the posting authority', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
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

  it('falls through to the unified entry when the session holds an active key (posting floor)', async () => {
    // Posting-class ops accept posting, active, or owner authority on chain
    // (steem transaction_util.hpp verify_authority fallback). The banner
    // hands the request to the unified entry; WHICH session key signs is the
    // hook's resolution (pinned in use-session-signing.test.tsx).
    renderBanner({}, { activeKey: '5K-active-key' });
    fireEvent.click(screen.getByRole('button', { name: 'claimRewards' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith(CLAIM_REQUEST);
    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The keyless hint is hidden: an active key can sign posting operations.
    expect(screen.queryByText('claimNeedPostingKey')).not.toBeInTheDocument();
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
    // The remembered branch bypasses the unified entry entirely.
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('falls through to the unified entry when the remembered posting key fails verification', async () => {
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

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledWith(CLAIM_REQUEST);
    expect(signClaim).not.toHaveBeenCalled();
    await waitFor(() => expect(broadcastClaim).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
