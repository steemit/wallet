'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import {
  nextHistoryIndex,
  paginateReversedHistory,
  sumCurationRewardsLastWeek,
} from '@/lib/wallet/rewards-history';
import { useRewardsHistory } from '@/lib/wallet/use-rewards-history';
import {
  formatSteemPowerDisplay,
  steemPowerFromVests,
} from '@/lib/wallet/vest-steem';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import { RewardsHistoryPager } from '@/components/wallet/rewards-history-pager';
import { RewardsLoadMore } from '@/components/wallet/rewards-load-more';
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

export function CurationRewardsSection({
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
  const [historyIndex, setHistoryIndex] = useState(0);
  const {
    history: curationHistory,
    loading,
    loadingMore,
    exhausted,
    totalFetched,
    loadMore,
  } = useRewardsHistory(username, 'curation_reward');

  const rewardsWeekVests = useMemo(
    () => sumCurationRewardsLastWeek(curationHistory),
    [curationHistory]
  );

  const weekSteemPower =
    globalProps != null
      ? formatSteemPowerDisplay(steemPowerFromVests(rewardsWeekVests, globalProps))
      : '—';

  const { page, canGoNewer, canGoOlder } = paginateReversedHistory(
    curationHistory,
    historyIndex
  );

  if (loading) {
    return (
      <div className="UserWallet space-y-4">
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const isEmpty = curationHistory.length === 0;
  const showEmptyHint = isEmpty && totalFetched > 0 && !exhausted;

  return (
    <div className="UserWallet curation-rewards space-y-4">
      <div className="UserWallet__balance UserReward__row grid gap-2 sm:grid-cols-[1fr_auto] sm:items-baseline">
        <div className="text-sm text-muted-foreground sm:text-base">
          {t('estimatedCurationRewardsLastWeek')}:
        </div>
        <div className="text-sm font-medium sm:pl-5 sm:text-base">
          {globalPropsLoading && !globalProps ? (
            <Skeleton className="h-5 w-32" />
          ) : (
            <>
              {weekSteemPower} {STEEM_POWER_LABEL}
            </>
          )}
        </div>
      </div>

      <Separator />

      <div>
        <h4 className="mb-3 text-lg font-medium">{t('curationRewardsHistory')}</h4>
        {isEmpty ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{t('noRewardsHistory')}</p>
            {showEmptyHint && (
              <p className="text-sm text-muted-foreground">
                {t('rewardsNoMatchesHint', { count: totalFetched })}
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
                const author = String(data.comment_author ?? '');
                const permlink = String(data.comment_permlink ?? '');
                const rewardAsset = data.reward as string | undefined;
                const displaySp =
                  globalProps && rewardAsset
                    ? `${formatSteemPowerDisplay(
                        steemPowerFromVests(parseAssetAmount(rewardAsset), globalProps)
                      )} ${STEEM_POWER_LABEL}`
                    : rewardAsset ?? '—';

                return (
                  <TableRow key={`${item.trx_id}-${index}`}>
                    <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
                      {formatTimeAgo(item.timestamp, locale)}
                    </TableCell>
                    <TableCell className="max-w-[40rem] align-top text-sm">
                      {t('curationRewardRow', { amount: displaySp })}{' '}
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
        {curationHistory.length > 0 && (
          <RewardsHistoryPager
            canGoNewer={canGoNewer}
            canGoOlder={canGoOlder}
            onNewer={() => setHistoryIndex((i) => nextHistoryIndex(i, 'newer'))}
            onOlder={() => setHistoryIndex((i) => nextHistoryIndex(i, 'older'))}
          />
        )}
        {!exhausted && <RewardsLoadMore loading={loadingMore} onClick={loadMore} />}
      </div>
    </div>
  );
}
