/**
 * BalanceRows delegation display tests (review finding G-3).
 *
 * Legacy parity: legacy `delegatedSteem`
 * (wallet-legacy src/app/utils/StateFunctions.js:63-78) computes the NET of
 * delegated minus received vesting shares, and UserWallet.jsx:659-661 / 938-984
 * shows "(+X STEEM)" for net received / "(-X STEEM)" for net delegated out,
 * with the delegated/not-delegated secondary text keyed off net != 0. The
 * rewrite only read delegated_vesting_shares, so accounts that only RECEIVE
 * delegations were told "Your STEEM POWER is not currently delegated".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BalanceRows } from '@/components/wallet/balance-rows';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

vi.mock('next-intl', () => ({
  // Echo the key plus interpolated values so assertions can see both.
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}|${JSON.stringify(values)}` : key,
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/use-wallet-estimated-value', () => ({
  useWalletEstimatedValue: () => ({ display: '$0.00', loading: false, details: null }),
}));

// 100 VESTS = 50 STEEM, so 10 VESTS = 5 SP / 25 VESTS = 12.5 SP.
const globalProps: GlobalPropsData = {
  total_vesting_shares: '100.000000 VESTS',
  total_vesting_fund_steem: '50.000 STEEM',
};

function makeBalance(
  delegated: string,
  received: string
): WalletBalanceData {
  return {
    balance: '0.000 STEEM',
    sbd_balance: '0.000 SBD',
    vesting_shares: '1000.000000 VESTS',
    delegated_vesting_shares: delegated,
    received_vesting_shares: received,
    vesting_withdraw_rate: '0.000000 VESTS',
    savings_balance: '0.000 STEEM',
    savings_sbd_balance: '0.000 SBD',
    next_vesting_withdrawal: '1970-01-01T00:00:00',
    to_withdraw: 0,
    withdrawn: 0,
    reward_steem_balance: '0.000 STEEM',
    reward_sbd_balance: '0.000 SBD',
    reward_vesting_steem: '0.000 STEEM',
    reward_vesting_balance: '0.000000 VESTS',
  };
}

function renderRows(balance: WalletBalanceData) {
  return render(
    <TooltipProvider>
      <BalanceRows
        username="parityuser"
        balance={balance}
        globalProps={globalProps}
        loading={false}
        showBalanceActions={false}
      />
    </TooltipProvider>
  );
}

describe('BalanceRows delegation display (legacy net semantics)', () => {
  it('shows received delegation info for a receive-only account', () => {
    renderRows(makeBalance('0.000000 VESTS', '10.000000 VESTS'));
    // Net = -5 SP -> "+5.000" indicator and the delegated warning text.
    expect(screen.getByText(/\(\+5\.000 STEEM\)/)).toBeTruthy();
    expect(screen.getByText(/delegatedPowerWarning\|\{"username":"parityuser"\}/)).toBeTruthy();
    expect(screen.queryByText('powerNotDelegated')).toBeNull();
  });

  it('shows net delegated-out with the legacy minus sign', () => {
    // 40 VESTS out, 15 VESTS in -> net +12.5 SP delegated out -> "-12.500".
    renderRows(makeBalance('40.000000 VESTS', '15.000000 VESTS'));
    expect(screen.getByText(/\(-12\.500 STEEM\)/)).toBeTruthy();
    expect(screen.getByText(/delegatedPowerWarning/)).toBeTruthy();
  });

  it('shows net received when incoming delegation is larger', () => {
    // 15 VESTS out, 40 VESTS in -> net -12.5 SP received -> "+12.500".
    renderRows(makeBalance('15.000000 VESTS', '40.000000 VESTS'));
    expect(screen.getByText(/\(\+12\.500 STEEM\)/)).toBeTruthy();
    expect(screen.getByText(/delegatedPowerWarning/)).toBeTruthy();
  });

  it('keeps the not-delegated state for accounts with no net delegation', () => {
    renderRows(makeBalance('0.000000 VESTS', '0.000000 VESTS'));
    expect(screen.getByText('powerNotDelegated')).toBeTruthy();
    expect(screen.queryByText(/delegatedPowerWarning/)).toBeNull();
    expect(screen.queryByText(/STEEM\)$/)).toBeNull();
  });
});
