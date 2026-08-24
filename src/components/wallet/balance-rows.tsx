'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  WalletBalanceRowColumns,
  WalletBalanceRowShell,
} from '@/components/wallet/wallet-balance-row-layout';
import { useWalletEstimatedValue } from '@/hooks/use-wallet-estimated-value';
import { getCurrentSteemPowerApr } from '@/lib/wallet/sp-apr';
import { formatTimeUntil } from '@/lib/wallet/format-time-ago';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';

function numberWithCommas(x: string): string {
  return x.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type BalanceDropdownItemConfig =
  | { label: string; external: true; href: string }
  | { label: string; link: string }
  | { label: string; walletAction: WalletModalAction; asset?: string; type?: string };

export function BalanceRows({
  username,
  balance,
  globalProps,
  loading,
  showBalanceActions = true,
}: {
  username: string;
  balance: WalletBalanceData | null;
  globalProps: GlobalPropsData | null;
  loading: boolean;
  /** When false, hide per-asset dropdowns (view-only balances). */
  showBalanceActions?: boolean;
}) {
  const t = useTranslations('wallet');

  const {
    display: estimatedValueDisplay,
    loading: estimatedValueLoading,
    details: extrasDetails,
  } = useWalletEstimatedValue({
    username,
    balance,
    globalProps,
    includeOpenOrders: showBalanceActions,
    enabled: !loading && !!balance && !!globalProps,
  });

  const [showAllConversions, setShowAllConversions] = useState(false);

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

  const isPoweringDown = balance && parseFloat(balance.vesting_withdraw_rate?.split(' ')[0] || '0') > 0;
  const powerDownRate = balance ? calculateSP(balance.vesting_withdraw_rate) : '0';

  const spApr = globalProps ? getCurrentSteemPowerApr(globalProps) : null;
  const steemOrders = showBalanceActions ? (extrasDetails?.steemOrders ?? 0) : 0;
  const sbdOrders = showBalanceActions ? (extrasDetails?.sbdOrders ?? 0) : 0;
  const conversions = extrasDetails?.conversions ?? [];

  if (loading) {
    return (
      <div className="flex flex-col">
        {[1, 2, 3, 4, 5].map((i) => (
          <WalletBalanceRowShell key={i}>
            <WalletBalanceRowColumns
              left={
                <>
                  <Skeleton className="h-5 w-32 mb-2" />
                  <Skeleton className="h-4 w-64" />
                </>
              }
              right={
                <div className="flex justify-end">
                  <Skeleton className="h-5 w-24" />
                </div>
              }
            />
          </WalletBalanceRowShell>
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
      {/* STEEM Balance Row */}
      <WalletBalanceRowShell>
        <WalletBalanceRowColumns
          left={
            <>
              <div className="font-medium">STEEM</div>
              <div className="secondary">
                Liquid token, tradeable and transferable at any time. Can also be converted to STEEM POWER through a process called powering up.
              </div>
            </>
          }
          right={
            <div className="whitespace-nowrap">
              <BalanceDropdown
                username={username}
                selected={steemBalance + ' STEEM'}
                showMenu={showBalanceActions}
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
                    walletAction: 'powerUp',
                  },
                  { label: 'Trade', external: true, href: 'https://www.poloniex.com/zh-CN/trade/STEEM_USDT?type=spot' },
                  { label: 'Market', link: '/market' },
                ]}
              />
              {steemOrders > 0 && (
                <div className="text-sm text-muted-foreground mt-1">
                  <Link href="/market">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">
                          (+{numberWithCommas(steemOrders.toFixed(3))} STEEM)
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t('openOrders')}</TooltipContent>
                    </Tooltip>
                  </Link>
                </div>
              )}
            </div>
          }
        />
      </WalletBalanceRowShell>

      {/* STEEM POWER Row (zebra) */}
      <WalletBalanceRowShell zebra>
        <WalletBalanceRowColumns
          left={
            <>
              <div className="font-medium">STEEM POWER</div>
              <div className="secondary">
                Influence tokens which give you more control over post payouts and allow you to earn on curation rewards.
                {hasDelegation && (
                  <span className="block mt-1">Part of your STEEM POWER is currently delegated.</span>
                )}
                {!hasDelegation && (
                  <span className="block mt-1">Your STEEM POWER is not currently delegated.</span>
                )}
                {spApr !== null && spApr > 0 && (
                  <span className="block mt-1">
                    {t('steemPowerApr', { value: spApr.toFixed(2) })}
                  </span>
                )}
              </div>
            </>
          }
          right={
            <div className="whitespace-nowrap">
              <BalanceDropdown
                username={username}
                selected={spBalance + ' STEEM'}
                showMenu={showBalanceActions}
                items={[
                  { label: 'Delegate', walletAction: 'delegate' },
                  { label: 'Power Down', walletAction: 'powerDown' },
                  ...(isPoweringDown
                    ? [{ label: 'Cancel Power Down', walletAction: 'cancelPowerDown' as const }]
                    : []),
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
          }
        />
      </WalletBalanceRowShell>

      {/* STEEM DOLLARS Row */}
      <WalletBalanceRowShell>
        <WalletBalanceRowColumns
          left={
            <>
              <div className="font-medium">STEEM DOLLARS</div>
              <div className="secondary">
                Tradeable tokens that may be transferred anywhere at anytime. May also be converted to STEEM.
              </div>
            </>
          }
          right={
            <div className="whitespace-nowrap">
              <BalanceDropdown
                username={username}
                selected={sbdBalance}
                showMenu={showBalanceActions}
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
              {sbdOrders > 0 && (
                <div className="text-sm text-muted-foreground mt-1">
                  <Link href="/market">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">
                          (+${numberWithCommas(sbdOrders.toFixed(3))})
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t('openOrders')}</TooltipContent>
                    </Tooltip>
                  </Link>
                </div>
              )}
              {conversions.slice(0, 5).map((conv) => (
                <div key={conv.requestid} className="text-sm text-muted-foreground mt-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help">
                        (+{t('inConversion', {
                          amount: '$' + numberWithCommas(conv.amountSbd.toFixed(3)),
                        })})
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('conversionCompleteTip', {
                        date: new Date(conv.finishTime).toLocaleString(),
                      })}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
              {conversions.length > 5 && (
                <>
                  <button
                    type="button"
                    className="text-primary mt-2 cursor-pointer text-sm hover:underline"
                    onClick={() => setShowAllConversions(true)}
                  >
                    {t('viewAllPendingConversions', { count: conversions.length })}
                  </button>
                  <Dialog open={showAllConversions} onOpenChange={setShowAllConversions}>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t('pendingConversionsTitle')}</DialogTitle>
                      </DialogHeader>
                      <ul className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
                        {conversions.map((conv) => (
                          <li key={conv.requestid} className="flex justify-between gap-4">
                            <span>${numberWithCommas(conv.amountSbd.toFixed(3))}</span>
                            <span className="text-muted-foreground">
                              {t('conversionCompleteTip', {
                                date: new Date(conv.finishTime).toLocaleString(),
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </DialogContent>
                  </Dialog>
                </>
              )}
            </div>
          }
        />
      </WalletBalanceRowShell>

      {/* Savings Row (zebra) */}
      <WalletBalanceRowShell zebra>
        <WalletBalanceRowColumns
          left={
            <>
              <div className="font-medium">{t('savings', { defaultMessage: 'Savings' })}</div>
              <div className="secondary">
                Balance subject to 3 day withdraw waiting period.
              </div>
            </>
          }
          right={
            <div className="whitespace-nowrap">
              <BalanceDropdown
                username={username}
                selected={savingsBalance}
                showMenu={showBalanceActions}
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
                  showMenu={showBalanceActions}
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
          }
        />
      </WalletBalanceRowShell>

      {/* Estimated Value Row */}
      <WalletBalanceRowShell>
        <WalletBalanceRowColumns
          left={
            <>
              <div className="font-medium">{t('estimatedValue', { defaultMessage: 'Estimated Account Value' })}</div>
              <div className="secondary">{t('estimatedValueDesc')}</div>
            </>
          }
          right={
            <div>
              <div className="font-medium text-lg tabular-nums">
                {estimatedValueLoading ? '---' : estimatedValueDisplay}
              </div>
            </div>
          }
        />
      </WalletBalanceRowShell>

      {/* Power Down Notice */}
      {isPoweringDown && (
        <WalletBalanceRowShell zebra borderless>
          <div className="text-sm">
            The next power down is scheduled to happen{' '}
            <span className="font-medium">
              {balance?.next_vesting_withdrawal
                ? formatTimeUntil(balance.next_vesting_withdrawal)
                : '---'}
            </span>{' '}
            (~{powerDownRate} SP).
          </div>
        </WalletBalanceRowShell>
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
  showMenu,
}: {
  username: string;
  selected: string;
  items: BalanceDropdownItemConfig[];
  showMenu: boolean;
}) {
  const router = useRouter();

  if (!showMenu) {
    return <span className="text-right font-medium tabular-nums">{selected}</span>;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="Wallet_dropdown inline-flex items-center gap-1 text-right font-medium transition-colors hover:text-accent-foreground">
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
