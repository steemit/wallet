'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useLazyEnabled } from '@/hooks/use-lazy-enabled';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import { sumAuthorRewardsLastWeek } from '@/lib/wallet/rewards-history';
import { useRewardsHistory } from '@/lib/wallet/use-rewards-history';
import { useRewardsHistoryPager } from '@/lib/wallet/use-rewards-history-pager';
import {
  formatSteemPowerDisplay,
  steemPowerFromVests,
} from '@/lib/wallet/vest-steem';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import { RewardsHistoryPager } from '@/components/wallet/rewards-history-pager';
import { RewardsPostLink } from '@/components/wallet/rewards-post-link';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const DEFAULT_SOCIAL_URL = 'https://steemit.com';
const STEEM_POWER_LABEL = 'STEEM POWER';

function formatAuthorRowAmounts(
  data: Record<string, unknown>,
  globalProps: GlobalPropsData | null
): { sp: string; steem: string; sbd: string } {
  const vestingPayout = data.vesting_payout as string | undefined;
  const steemPayout = data.steem_payout as string | undefined;
  const sbdPayout = data.sbd_payout as string | undefined;

  const sp =
    globalProps && vestingPayout
      ? `${formatSteemPowerDisplay(
          steemPowerFromVests(parseAssetAmount(vestingPayout), globalProps)
        )} ${STEEM_POWER_LABEL}`
      : vestingPayout ?? '—';

  return {
    sp,
    steem: steemPayout && steemPayout !== '0.000 STEEM' ? steemPayout : '',
    sbd: sbdPayout && sbdPayout !== '0.000 SBD' ? sbdPayout : '',
  };
}

export function AuthorRewardsSection({
  username,
  globalProps,
  globalPropsLoading,
  socialUrl = DEFAULT_SOCIAL_URL,
}: {
  username: string;
  globalProps: GlobalPropsData | null;
  globalPropsLoading: boolean;
  socialUrl?: string;
}) {
  const t = useTranslations('wallet');
  const locale = useLocale();
  const lazyEnabled = useLazyEnabled();
  const historyState = useRewardsHistory(username, 'author_reward', lazyEnabled);
  const {
    history: authorHistory,
    loading,
    totalFetched,
    error,
  } = historyState;
  const {
    page,
    canGoNewer,
    canGoOlder,
    onNewer,
    onOlder,
    loadingOlder,
    canFetchMore,
  } = useRewardsHistoryPager(historyState, username);

  const weekTotals = useMemo(() => sumAuthorRewardsLastWeek(authorHistory), [authorHistory]);

  const weekSummary = useMemo(() => {
    if (!globalProps) return null;
    const lines: string[] = [];
    lines.push(
      `${formatSteemPowerDisplay(steemPowerFromVests(weekTotals.vests, globalProps))} ${STEEM_POWER_LABEL}`
    );
    lines.push(`${weekTotals.steem.toFixed(3)} STEEM`);
    lines.push(`${weekTotals.sbd.toFixed(3)} SBD`);
    return lines;
  }, [globalProps, weekTotals]);

  if (!lazyEnabled || loading) {
    return (
      <div className="UserWallet space-y-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const isEmpty = authorHistory.length === 0;
  const showEmptyHint = isEmpty && totalFetched > 0;
  return (
    <div className="UserWallet author-rewards space-y-4">
      <div className="UserWallet__balance UserReward__row grid gap-2 sm:grid-cols-[1fr_auto] sm:items-baseline">
        <div className="text-sm text-muted-foreground sm:text-base">
          {t('estimatedAuthorRewardsLastWeek')}:
        </div>
        <div className="space-y-0.5 text-sm font-medium sm:pl-5 sm:text-base">
          {globalPropsLoading && !globalProps ? (
            <Skeleton className="h-14 w-32" />
          ) : weekSummary ? (
            weekSummary.map((line) => <div key={line}>{line}</div>)
          ) : (
            <span>—</span>
          )}
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="mb-3 text-lg font-medium">{t('authorRewardsHistory')}</h4>
        {isEmpty ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('noRewardsHistory')}</p>
            {showEmptyHint && (
              <p className="text-sm text-muted-foreground">
                {t('rewardsNoMatchesHint', { count: totalFetched })}
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive">
                {t('rewardsFetchError', { error })}
              </p>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader className="hidden md:table-header-group">
              <TableRow>
                <TableHead className="w-[7rem]">{t('rewardsTime')}</TableHead>
                <TableHead>{t('rewardsDescription')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('rewardsMemo')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.map((item, index) => {
                const data = item.op[1];
                const author = String(data.author ?? '');
                const permlink = String(data.permlink ?? '');
                const { sp, steem, sbd } = formatAuthorRowAmounts(data, globalProps);
                const monetary = [sbd, steem].filter(Boolean).join(', ');
                const prefix = monetary ? `${monetary} ${t('authorRewardJoin')} ` : '';

                return (
                  <TableRow key={`${item.trx_id}-${index}`}>
                    <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
                      {formatTimeAgo(item.timestamp, locale)}
                    </TableCell>
                    <TableCell className="max-w-[40rem] align-top text-sm">
                      {t('authorRewardRow', {
                        prefix,
                        authorReward: sp,
                      })}{' '}
                      <RewardsPostLink
                        socialUrl={socialUrl}
                        author={author}
                        permlink={permlink}
                      />
                    </TableCell>
                    <TableCell className="hidden max-w-[40rem] break-words align-top text-sm text-muted-foreground md:table-cell">
                      —
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {(authorHistory.length > 0 || canFetchMore) && (
          <RewardsHistoryPager
            canGoNewer={canGoNewer}
            canGoOlder={canGoOlder}
            loadingOlder={loadingOlder}
            onNewer={onNewer}
            onOlder={onOlder}
          />
        )}
      </div>
    </div>
  );
}
