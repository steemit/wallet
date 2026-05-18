'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLazyEnabled } from '@/hooks/use-lazy-enabled';
import {
  nextHistoryIndex,
  paginateReversedHistory,
} from '@/lib/wallet/rewards-history';
import { useActivityHistory } from '@/lib/wallet/use-activity-history';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { RewardsHistoryPager } from '@/components/wallet/rewards-history-pager';
import { RewardsLoadMore } from '@/components/wallet/rewards-load-more';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

function formatTransferRow(item: SteemHistoryItem, context: string) {
  const [type, data] = item.op;

  switch (type) {
    case 'transfer': {
      const isReceive = data.to === context;
      return {
        icon: isReceive ? '↓' : '↑',
        description: isReceive
          ? `Received ${data.amount} from ${data.from}`
          : `Transferred ${data.amount} to ${data.to}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    }
    case 'transfer_to_vesting':
      return {
        icon: '⚡',
        description: data.from === data.to
          ? `Powered up ${data.amount}`
          : `${data.from} powered up ${data.amount} to ${data.to}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'withdraw_vesting':
      return {
        icon: '🔻',
        description: `Started power down of ${data.vesting_shares}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'fill_vesting_withdraw':
      return {
        icon: '💧',
        description: `Withdrew ${data.deposited}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'claim_reward_balance':
      return {
        icon: '🎁',
        description: `Claimed rewards: ${data.reward_steem} ${data.reward_sbd} ${data.reward_vests}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'transfer_to_savings':
      return {
        icon: '🏦',
        description: `Transfer to savings: ${data.amount}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'transfer_from_savings':
      return {
        icon: '🏧',
        description: `Withdraw from savings: ${data.amount}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'delegate_vesting_shares':
      return {
        icon: '📤',
        description: data.delegator === context
          ? `Delegated ${data.vesting_shares} to ${data.delegatee}`
          : `Received delegation of ${data.vesting_shares} from ${data.delegator}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    default:
      return {
        icon: '📋',
        description: type.replace(/_/g, ' '),
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
  }
}

export function RecentActivity({
  username,
  refreshNonce,
}: {
  username: string;
  refreshNonce?: number;
}) {
  const t = useTranslations('wallet');
  const lazyEnabled = useLazyEnabled();
  const [historyIndex, setHistoryIndex] = useState(0);
  const {
    history,
    loading,
    loadingMore,
    exhausted,
    totalFetched,
    error,
    loadMore,
  } = useActivityHistory(username, refreshNonce, lazyEnabled);

  const { page, canGoNewer, canGoOlder } = paginateReversedHistory(history, historyIndex);

  if (!lazyEnabled) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-8">
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!history.length) {
    return null;
  }

  const canLoadMore = !exhausted || error != null;
  const showEmptyHint = page.length === 0 && totalFetched > 0;

  return (
    <div className="mt-8">
      <Separator className="mb-6" />
      <h4 className="text-lg font-medium mb-2 px-4">{t('history', { defaultMessage: 'History' })}</h4>
      <div className="secondary mb-4 px-4">
        <span>{t('memoWarningSpam')} </span>
        <span>{t('memoWarningLinks')} </span>
        <span>{t('memoWarningKeys')} </span>
        <span>{t('memoWarningConfirmation')}</span>
      </div>
      {showEmptyHint && (
        <p className="text-sm text-muted-foreground px-4">
          {t('activityNoMatchesHint', {
            count: totalFetched,
            defaultMessage: 'No matching activity in the latest {count} records. Load more to keep looking.',
          })}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive px-4">
          {t('activityFetchError', {
            error,
            defaultMessage: 'Failed to load activity: {error}. Tap Load more to retry.',
          })}
        </p>
      )}
      <Table>
        <TableBody>
          {page.map((item, index) => {
            const row = formatTransferRow(item, username);
            return (
              <TableRow key={`${item.trx_id}-${index}`}>
                <TableCell className="w-8 text-lg">{row.icon}</TableCell>
                <TableCell>
                  <div className="font-medium text-sm">{row.description}</div>
                  {row.memo && (
                    <div className="text-xs text-muted-foreground truncate max-w-md mt-0.5">
                      {row.memo}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                  {row.time}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {history.length > 0 && (
        <RewardsHistoryPager
          canGoNewer={canGoNewer}
          canGoOlder={canGoOlder}
          onNewer={() => setHistoryIndex((i) => nextHistoryIndex(i, 'newer'))}
          onOlder={() => setHistoryIndex((i) => nextHistoryIndex(i, 'older'))}
        />
      )}
      {canLoadMore && <RewardsLoadMore loading={loadingMore} onClick={loadMore} />}
    </div>
  );
}
