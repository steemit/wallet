'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { useTranslations } from 'next-intl';
import type { SteemAccount } from '@/lib/steem/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from '@/i18n/routing';
import {
  buildWalletModalSearchString,
  transfersHref,
  type WalletModalAction,
} from '@/lib/wallet/wallet-modal-search-params';

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

interface GlobalPropsData {
  total_vesting_shares: string;
  total_vesting_fund_steem: string;
}

function numberWithCommas(x: string): string {
  return x.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type BalanceDropdownItemConfig =
  | { label: string; external: true; href: string }
  | { label: string; link: string }
  | { label: string; walletAction: WalletModalAction; asset?: string; type?: string };

export function BalanceRows({
  username,
  refreshNonce = 0,
}: {
  username: string;
  /** Increment after wallet modal completes to refetch balances. */
  refreshNonce?: number;
}) {
  const t = useTranslations('wallet');
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [globalProps, setGlobalProps] = useState<GlobalPropsData | null>(null);
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
        setBalance(account as unknown as BalanceData);
        if (propsResponse.error) {
          console.error(propsResponse.error);
          return;
        }
        setGlobalProps(propsResponse.props as unknown as GlobalPropsData);
      } catch (err) {
        console.error('Error fetching balance:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [username, refreshNonce]);

  const formatBalance = (value: string | undefined) => {
    if (!value) return '0.000';
    const match = value.match(/([\d.]+)\s+(STEEM|SBD|VESTS)/);
    if (!match || !match[1]) return '0.000';
    return numberWithCommas(parseFloat(match[1]).toFixed(3));
  };

  const formatSBD = (value: string | undefined) => {
    if (!value) return '$0.000';
    const parts = value.split(' ');
    const amount = parseFloat(parts[0] || '0') || 0;
    return '$' + numberWithCommas(amount.toFixed(3));
  };

  const calculateSP = (vests: string | undefined) => {
    if (!vests || !globalProps) return '0.000';
    const vestAmount = parseFloat(vests.split(' ')[0] || '0') || 0;
    const totalVestingShares = parseFloat(globalProps.total_vesting_shares?.split(' ')[0] || '1') || 1;
    const totalVestingFund = parseFloat(globalProps.total_vesting_fund_steem?.split(' ')[0] || '0') || 0;
    const sp = (vestAmount / totalVestingShares) * totalVestingFund;
    return numberWithCommas(sp.toFixed(3));
  };

  const getDelegatedSP = () => {
    if (!balance?.delegated_vesting_shares || !globalProps) return { display: '0.000', raw: 0 };
    const delegatedAmount = parseFloat(balance.delegated_vesting_shares.split(' ')[0] || '0') || 0;
    const totalVestingShares = parseFloat(globalProps.total_vesting_shares?.split(' ')[0] || '1') || 1;
    const totalVestingFund = parseFloat(globalProps.total_vesting_fund_steem?.split(' ')[0] || '0') || 0;
    const sp = (delegatedAmount / totalVestingShares) * totalVestingFund;
    return {
      display: (sp < 0 ? '+' : '') + numberWithCommas(Math.abs(sp).toFixed(3)),
      raw: sp,
    };
  };

  // Check for rewards
  const hasRewards = balance && (
    parseFloat(balance.reward_steem_balance || '0') > 0 ||
    parseFloat(balance.reward_sbd_balance || '0') > 0 ||
    parseFloat(balance.reward_vesting_steem || '0') > 0
  );

  const buildRewardsStr = () => {
    if (!balance) return '';
    const rewards: string[] = [];
    const rewardSteem = balance.reward_steem_balance;
    const rewardSbd = balance.reward_sbd_balance;
    const rewardSp = balance.reward_vesting_steem;
    if (rewardSteem && parseFloat(rewardSteem.split(' ')[0] || '0') > 0) rewards.push(rewardSteem);
    if (rewardSbd && parseFloat(rewardSbd.split(' ')[0] || '0') > 0) rewards.push(rewardSbd);
    if (rewardSp && parseFloat(rewardSp.split(' ')[0] || '0') > 0) {
      rewards.push(rewardSp.replace('STEEM', 'SP'));
    }
    if (rewards.length === 3) return `${rewards[0]}, ${rewards[1]} and ${rewards[2]}`;
    if (rewards.length === 2) return `${rewards[0]} and ${rewards[1]}`;
    if (rewards.length === 1) return rewards[0];
    return '';
  };

  const isPoweringDown = balance && parseFloat(balance.vesting_withdraw_rate?.split(' ')[0] || '0') > 0;
  const powerDownRate = balance ? calculateSP(balance.vesting_withdraw_rate) : '0';

  if (loading) {
    return (
      <div className="flex flex-col gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="UserWallet__balance border-b border-border">
            <div className="flex justify-between items-start gap-4 py-4">
              <div className="flex-1">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const steemBalance = balance ? formatBalance(balance.balance) : '0.000';
  const sbdBalance = balance ? formatSBD(balance.sbd_balance) : '$0.000';
  const spBalance = balance ? calculateSP(balance.vesting_shares) : '0.000';
  const savingsBalance = balance ? formatBalance(balance.savings_balance) + ' STEEM' : '0.000 STEEM';
  const savingsSbdBalance = balance ? formatSBD(balance.savings_sbd_balance) : '$0.000';
  const delegatedSP = getDelegatedSP();
  const hasDelegation = delegatedSP.raw !== 0;

  return (
    <div>
      {/* Claim Rewards Box */}
      {hasRewards && (
        <div className="UserWallet__claimbox">
          <span className="font-bold">
            Your current rewards: {buildRewardsStr()}
          </span>
          <Button size="sm">
            {t('claimRewards', { defaultMessage: 'Redeem Rewards' })}
          </Button>
        </div>
      )}

      {/* STEEM Balance Row */}
      <div className="UserWallet__balance border-b border-border">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
          <div className="flex-1">
            <div className="font-bold">STEEM</div>
            <div className="secondary">
              Liquid token, tradeable and transferable at any time. Can also be converted to STEEM POWER through a process called powering up.
            </div>
          </div>
          <div className="md:text-right whitespace-nowrap">
            <BalanceDropdown
              username={username}
              selected={steemBalance + ' STEEM'}
              items={[
                {
                  label: 'Transfer',
                  walletAction: 'transfer',
                  asset: 'STEEM',
                  type: 'transfer',
                },
                {
                  label: 'Transfer to Savings',
                  walletAction: 'transfer',
                  asset: 'STEEM',
                  type: 'savings',
                },
                {
                  label: 'Power Up',
                  walletAction: 'transfer',
                  asset: 'STEEM',
                  type: 'power_up',
                },
                { label: 'Trade', external: true, href: 'https://poloniex.com/trade/STEEM_TRX/?type=spot' },
                { label: 'Market', link: '/market' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* STEEM POWER Row (zebra) */}
      <div className="UserWallet__balance border-b border-border bg-zebra">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
          <div className="flex-1">
            <div className="font-bold">STEEM POWER</div>
            <div className="secondary">
              Influence tokens which give you more control over post payouts and allow you to earn on curation rewards.
              {hasDelegation && (
                <span className="block mt-1">Part of your STEEM POWER is currently delegated.</span>
              )}
              {!hasDelegation && (
                <span className="block mt-1">Your STEEM POWER is not currently delegated.</span>
              )}
            </div>
          </div>
          <div className="md:text-right whitespace-nowrap">
            <BalanceDropdown
              username={username}
              selected={spBalance + ' STEEM'}
              items={[
                { label: 'Delegate', walletAction: 'delegate' },
                { label: 'Power Down', walletAction: 'powerDown' },
                { label: 'Advanced Routes', walletAction: 'advanced' },
              ]}
            />
            {hasDelegation && (
              <div className="text-sm text-muted-foreground mt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">({delegatedSP.display} STEEM)</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    STEEM POWER delegated to/from this account
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STEEM DOLLARS Row */}
      <div className="UserWallet__balance border-b border-border">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
          <div className="flex-1">
            <div className="font-bold">STEEM DOLLARS</div>
            <div className="secondary">
              Tradeable tokens that may be transferred anywhere at anytime. May also be converted to STEEM.
            </div>
          </div>
          <div className="md:text-right whitespace-nowrap">
            <BalanceDropdown
              username={username}
              selected={sbdBalance}
              items={[
                { label: 'Transfer', walletAction: 'transfer', asset: 'SBD', type: 'transfer' },
                { label: 'Transfer to Savings', walletAction: 'transfer', asset: 'SBD', type: 'savings' },
                { label: 'Convert to STEEM', walletAction: 'convert' },
                { label: 'Market', link: '/market' },
                {
                  label: 'Trade',
                  external: true,
                  href: 'https://global.bittrex.com/Market/Index?MarketName=BTC-SBD',
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Savings Row (zebra) */}
      <div className="UserWallet__balance border-b border-border bg-zebra">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
          <div className="flex-1">
            <div className="font-bold">{t('savings', { defaultMessage: 'Savings' })}</div>
            <div className="secondary">
              Balance subject to 3 day withdraw waiting period.
            </div>
          </div>
          <div className="md:text-right whitespace-nowrap">
            <BalanceDropdown
              username={username}
              selected={savingsBalance}
              items={[
                {
                  label: 'Withdraw STEEM',
                  walletAction: 'transfer',
                  asset: 'STEEM',
                  type: 'savings_withdraw',
                },
              ]}
            />
            <div className="mt-1">
              <BalanceDropdown
                username={username}
                selected={savingsSbdBalance}
                items={[
                  {
                    label: 'Withdraw Steem Dollars',
                    walletAction: 'transfer',
                    asset: 'SBD',
                    type: 'savings_withdraw',
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Estimated Value Row */}
      <div className="UserWallet__balance border-b border-border">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-2">
          <div className="flex-1">
            <div className="font-bold">{t('estimatedValue', { defaultMessage: 'Estimated Account Value' })}</div>
            <div className="secondary">
              The estimated value is based on an average value of Steem in US dollars.
            </div>
          </div>
          <div className="md:text-right">
            <div className="font-bold text-lg">---</div>
          </div>
        </div>
      </div>

      {/* Power Down Notice */}
      {isPoweringDown && (
        <div className="UserWallet__balance bg-zebra">
          <div className="text-sm">
            The next power down is scheduled to happen{' '}
            <span className="font-medium">
              {balance?.next_vesting_withdrawal
                ? new Date(balance.next_vesting_withdrawal).toLocaleDateString()
                : '---'}
            </span>{' '}
            (~{powerDownRate} STEEM).
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================
   BalanceDropdown - per-row action dropout
   ============================================ */

function BalanceDropdown({
  username,
  selected,
  items,
}: {
  username: string;
  selected: string;
  items: BalanceDropdownItemConfig[];
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="Wallet_dropdown inline-flex items-center gap-1 font-bold hover:text-primary transition-colors text-right">
        {selected}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => {
          if ('walletAction' in item) {
            const q = buildWalletModalSearchString({
              walletAction: item.walletAction,
              ...(item.asset !== undefined ? { asset: item.asset } : {}),
              ...(item.type !== undefined ? { type: item.type } : {}),
            });
            return (
              <DropdownMenuItem
                key={item.label}
                onSelect={() => router.push(transfersHref(username, q))}
                className="cursor-pointer"
              >
                {item.label}
              </DropdownMenuItem>
            );
          }
          if ('link' in item) {
            return (
              <DropdownMenuItem key={item.label} asChild>
                <Link href={item.link} className="cursor-pointer">
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem key={item.label} asChild>
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
                {item.label}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
