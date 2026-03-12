'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { useTranslations } from 'next-intl';
import type { SteemAccount } from '@/lib/steem/types';
import { LegacyButton } from '@/components/ui/legacy-components';

interface BalanceData {
  balance: string;
  sbd_balance: string;
  vesting_shares: string;
  delegated_vesting_shares: string;
  received_vesting_shares: string;
  vesting_withdraw_rate: string;
  savings_balance: string;
  savings_sbd_balance: string;
  next_vesting_withdrawal: string;
  to_withdraw: string;
  withdrawn: string;
  reward_steem_balance: string;
  reward_sbd_balance: string;
  reward_vesting_steem: string;
}

export function BalanceRows({ username }: { username: string }) {
  const t = useTranslations('wallet');
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [globalProps, setGlobalProps] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        const [accountsResponse, propsResponse] = await Promise.all([
          apiClient.getAccounts([username]),
          apiClient.getGlobalProps(),
        ]);

        if (accountsResponse.error || !accountsResponse.accounts?.length) {
          console.error(accountsResponse.error || 'Failed to fetch balance');
          return;
        }

        const account = accountsResponse.accounts[0] as SteemAccount;
        setBalance(account as any);
        setGlobalProps(propsResponse);
      } catch (err) {
        console.error('Error fetching balance:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [username]);

  const formatBalance = (value: string | undefined) => {
    if (!value) return '0.000';
    const match = value.match(/([\d.]+)\s+(STEEM|SBD|VESTS)/);
    if (!match || !match[1]) return '0.000';
    return parseFloat(match[1]).toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
  };

  const formatSBD = (value: string | undefined) => {
    if (!value) return '$0.000';
    const parts = value.split(' ');
    const amount = parseFloat(parts[0] || '0') || 0;
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
  };

  // Calculate SP from VESTS
  const calculateSP = (vests: string | undefined) => {
    if (!vests || !globalProps) return '0';
    const vestAmount = parseFloat(vests.split(' ')[0] || '0') || 0;
    const totalVestingShares = parseFloat(globalProps.total_vesting_shares?.split(' ')[0] || '1') || 1;
    const totalVestingFund = parseFloat(globalProps.total_vesting_fund_steem?.split(' ')[0] || '0') || 0;
    const sp = (vestAmount / totalVestingShares) * totalVestingFund;
    return sp.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  };

  // Calculate delegated SP
  const calculateDelegatedSP = (delegated: string | undefined) => {
    if (!delegated || !globalProps) return { received: '0', delegated: '0' };
    const delegatedAmount = parseFloat(delegated.split(' ')[0] || '0') || 0;
    const totalVestingShares = parseFloat(globalProps.total_vesting_shares?.split(' ')[0] || '1') || 1;
    const totalVestingFund = parseFloat(globalProps.total_vesting_fund_steem?.split(' ')[0] || '0') || 0;
    const sp = (delegatedAmount / totalVestingShares) * totalVestingFund;
    const spStr = sp.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    // delegated_vesting_shares is negative when received, positive when delegated out
    const isReceived = delegatedAmount < 0;
    return {
      received: isReceived ? `+${spStr}` : spStr,
      delegated: isReceived ? spStr : `-${spStr}`,
    };
  };

  const delegatedSP = balance?.delegated_vesting_shares
    ? calculateDelegatedSP(balance.delegated_vesting_shares)
    : { received: '0', delegated: '0' };

  // Check for rewards
  const hasRewards = balance && (
    parseFloat(balance.reward_steem_balance || '0') > 0 ||
    parseFloat(balance.reward_sbd_balance || '0') > 0 ||
    parseFloat(balance.reward_vesting_steem || '0') > 0
  );

  const steemBalance = balance ? formatBalance(balance.balance) : '0.000';
  const sbdBalance = balance ? formatSBD(balance.sbd_balance) : '$0.000';
  const spBalance = balance ? calculateSP(balance.vesting_shares) : '0';
  const savingsBalance = balance ? `${formatBalance(balance.savings_balance)} STEEM` : '0.000 STEEM';
  const savingsSbdBalance = balance ? formatSBD(balance.savings_sbd_balance) : '$0.000';

  // Calculate power down
  const isPoweringDown = balance && parseFloat(balance.vesting_withdraw_rate?.split(' ')[0] || '0') > 0;
  const powerDownRate = balance ? calculateSP(balance.vesting_withdraw_rate) : '0';

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Claim Rewards Box */}
      {hasRewards && (
        <div className="mb-4 p-4 border border-teal rounded-legacy bg-[#f3faf0] flex items-center justify-between flex-wrap gap-4">
          <span className="font-bold">
            You have rewards to claim!
          </span>
          <LegacyButton variant="primary">
            {t('claimRewards', { defaultMessage: 'Redeem Rewards' })}
          </LegacyButton>
        </div>
      )}

      {/* STEEM Balance Row */}
      <div className="UserWallet__balance py-4 border-b border-themed">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="font-bold">STEEM</div>
            <div className="text-sm text-text-secondary mt-1">
              {t('liquidBalanceDesc', { defaultMessage: 'Liquid token, transferable at any time.' })}
            </div>
          </div>
          <div className="md:text-right">
            <div className="font-bold text-steem-blue">{steemBalance} STEEM</div>
          </div>
        </div>
      </div>

      {/* STEEM POWER Row - with zebra striping */}
      <div className="UserWallet__balance py-4 bg-zebra border-b border-themed">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="font-bold">STEEM POWER</div>
            <div className="text-sm text-text-secondary mt-1">
              {t('powerDesc', { defaultMessage: 'Influence token that gives you more influence.' })}
            </div>
            {parseFloat(balance?.delegated_vesting_shares?.split(' ')[0] || '0') !== 0 && (
              <div className="text-sm text-text-secondary mt-1">
                {delegatedSP.received} STEEM POWER {parseFloat(balance?.delegated_vesting_shares?.split(' ')[0] || '0') < 0 ? 'received' : 'delegated'} from/to this account
              </div>
            )}
          </div>
          <div className="md:text-right">
            <div className="font-bold text-steem-orange">{spBalance} STEEM</div>
            {parseFloat(balance?.delegated_vesting_shares?.split(' ')[0] || '0') !== 0 && (
              <div className="text-sm text-text-secondary">
                ({delegatedSP.received} STEEM)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STEEM DOLLARS Row */}
      <div className="UserWallet__balance py-4 border-b border-themed">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="font-bold">STEEM DOLLARS</div>
            <div className="text-sm text-text-secondary mt-1">
              {t('sbdDesc', { defaultMessage: 'Tradeable tokens that can be transferred to savings.' })}
            </div>
          </div>
          <div className="md:text-right">
            <div className="font-bold text-teal">{sbdBalance}</div>
          </div>
        </div>
      </div>

      {/* SAVINGS Row - with zebra striping */}
      <div className="UserWallet__balance py-4 bg-zebra border-b border-themed">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="font-bold">{t('savings', { defaultMessage: 'Savings' })}</div>
            <div className="text-sm text-text-secondary mt-1">
              {t('savingsDesc', { defaultMessage: 'Balance subject to 3 day withdraw waiting period.' })}
            </div>
          </div>
          <div className="md:text-right">
            <div className="font-bold">{savingsBalance}</div>
            <div className="font-bold mt-1">{savingsSbdBalance}</div>
          </div>
        </div>
      </div>

      {/* Estimated Account Value Row */}
      <div className="UserWallet__balance py-4 bg-zebra">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <div className="font-bold">{t('estimatedValue', { defaultMessage: 'Estimated Account Value' })}</div>
            <div className="text-sm text-text-secondary mt-1">
              {t('estimatedValueDesc', { defaultMessage: 'Approximate value in USD based on current market prices.' })}
            </div>
          </div>
          <div className="md:text-right">
            <div className="font-bold text-lg">---</div>
          </div>
        </div>
      </div>

      {/* Power Down Notice */}
      {isPoweringDown && (
        <div className="mt-4 p-4 rounded-legacy bg-module">
          <div className="text-sm">
            {t('nextPowerDown', { defaultMessage: 'Next power down is scheduled to happen' })} {' '}
            <span className="font-medium">
              {balance?.next_vesting_withdrawal ? new Date(balance.next_vesting_withdrawal).toLocaleDateString() : '---'}
            </span>
            {' '}(~{powerDownRate} STEEM).
          </div>
        </div>
      )}
    </div>
  );
}
