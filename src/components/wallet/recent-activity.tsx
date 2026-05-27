'use client';

import { useTranslations } from 'next-intl';
import { useLazyEnabled } from '@/hooks/use-lazy-enabled';
import { useActivityHistory } from '@/lib/wallet/use-activity-history';
import { useRewardsHistoryPager } from '@/lib/wallet/use-rewards-history-pager';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';
import { formatTimeAgo } from '@/lib/wallet/format-time-ago';
import { formatSteemPowerFromVestsString } from '@/lib/wallet/vest-steem';
import { parseAssetAmount } from '@/lib/wallet/parse-asset-amount';
import type { GlobalPropsData } from '@/lib/wallet/wallet-balance-types';
import { RewardsHistoryPager } from '@/components/wallet/rewards-history-pager';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

function asStr(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

function formatTransferRow(item: SteemHistoryItem, context: string, globalProps?: GlobalPropsData | null) {
  const [type, data] = item.op;

  switch (type) {
    case 'transfer': {
      const isReceive = data.to === context;
      return {
        description: isReceive
          ? `Received ${data.amount} from ${data.from}`
          : `Transferred ${data.amount} to ${data.to}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    }
    case 'transfer_to_vesting':
      return {
        description: data.from === data.to
          ? `Powered up ${data.amount}`
          : `${data.from} powered up ${data.amount} to ${data.to}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'withdraw_vesting': {
      const sp = globalProps
        ? `${formatSteemPowerFromVestsString(asStr(data.vesting_shares), globalProps)} SP`
        : '-- SP';
      return {
        description: `Started power down of ${sp}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    }
    case 'fill_vesting_withdraw':
      return {
        description: `Withdrew ${data.deposited}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'claim_reward_balance': {
      const vestsPart = globalProps
        ? `${formatSteemPowerFromVestsString(asStr(data.reward_vests), globalProps)} SP`
        : '-- SP';
      // parseAssetAmount extracts the leading number and tolerates " SP" / " STEEM" suffixes.
      const parts = [
        data.reward_steem,
        data.reward_sbd,
        vestsPart,
      ].filter((p) => p && parseAssetAmount(String(p)) > 0);
      return {
        description: parts.length
          ? `Claimed rewards: ${parts.join(' ')}`
          : 'Claimed rewards',
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    }
    case 'transfer_to_savings':
      return {
        description: `Transfer to savings: ${data.amount}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'transfer_from_savings':
      return {
        description: `Withdraw from savings: ${data.amount}`,
        memo: typeof data.memo === 'string' ? data.memo : '',
        time: formatTimeAgo(item.timestamp),
      };
    case 'delegate_vesting_shares': {
      const sp = globalProps
        ? `${formatSteemPowerFromVestsString(asStr(data.vesting_shares), globalProps)} SP`
        : '-- SP';
      return {
        description: data.delegator === context
          ? `Delegated ${sp} to ${data.delegatee}`
          : `Received delegation of ${sp} from ${data.delegator}`,
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
    }
    default:
      return {
        description: type.replace(/_/g, ' '),
        memo: '',
        time: formatTimeAgo(item.timestamp),
      };
  }
}

export function RecentActivity({
  username,
  refreshNonce,
  globalProps,
}: {
  username: string;
  refreshNonce?: number;
  globalProps?: GlobalPropsData | null;
}) {
  const t = useTranslations('wallet');
  const lazyEnabled = useLazyEnabled();
  const historyState = useActivityHistory(username, refreshNonce, lazyEnabled);
  const {
    history,
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
  } = useRewardsHistoryPager(historyState, `${username}:${refreshNonce ?? 0}`);

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

  if (!history.length && !canFetchMore) {
    return null;
  }

  const showEmptyHint = history.length === 0 && totalFetched > 0;

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
            const row = formatTransferRow(item, username, globalProps);
            return (
              <TableRow key={`${item.trx_id}-${index}`}>
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
      {(history.length > 0 || canFetchMore) && (
        <RewardsHistoryPager
          canGoNewer={canGoNewer}
          canGoOlder={canGoOlder}
          loadingOlder={loadingOlder}
          onNewer={onNewer}
          onOlder={onOlder}
        />
      )}
    </div>
  );
}
