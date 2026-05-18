'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/steem/client';
import { normalizeSteemHistoryList } from '@/lib/wallet/normalize-history';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import {
  filterHistoryByOpType,
  nextHistoryIndex,
  paginateReversedHistory,
  REWARDS_HISTORY_FETCH_LIMIT,
  sumCurationRewardsLastWeek,
} from '@/lib/wallet/rewards-history';
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
  const [historyIndex, setHistoryIndex] = useState(0);
  const [curationHistory, setCurationHistory] = useState<ReturnType<typeof filterHistoryByOpType>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await apiClient.getHistory(username, REWARDS_HISTORY_FETCH_LIMIT);
        if (cancelled) return;
        if (response.error) {
          console.error('Failed to fetch curation history:', response.error);
          setCurationHistory([]);
          setHistoryIndex(0);
          return;
        }
        const normalized = normalizeSteemHistoryList(response.history || []);
        setCurationHistory(filterHistoryByOpType(normalized, 'curation_reward'));
        setHistoryIndex(0);
      } catch (err) {
        console.error('Error fetching curation history:', err);
        if (!cancelled) {
          setCurationHistory([]);
          setHistoryIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

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
        {page.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRewardsHistory')}</p>
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
                      {formatTimeAgo(item.timestamp)}
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
      </div>
    </div>
  );
}
