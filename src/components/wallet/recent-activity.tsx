'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

interface TransferHistoryItem {
  op: [string, Record<string, unknown>];
  timestamp: string;
  block: number;
  trx_id: string;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

function formatTransferRow(item: TransferHistoryItem, context: string) {
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
  refreshNonce = 0,
}: {
  username: string;
  refreshNonce?: number;
}) {
  const t = useTranslations('wallet');
  const [history, setHistory] = useState<TransferHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await apiClient.getHistory(username);
        if (response.error) {
          console.error('Failed to fetch history:', response.error);
          return;
        }
        // Filter out rewards and null-payout items
        const transfers = (response.history || [])
          .filter((item: unknown) => {
            const i = item as unknown as {
              op?: [string, unknown];
              1?: { op?: [string, unknown] };
            };
            const type = i.op?.[0] || i[1]?.op?.[0];
            if (!type) return false;
            if (type === 'curation_reward' || type === 'author_reward' || type === 'comment_benefactor_reward') {
              return false;
            }
            return true;
          })
          .map((item: unknown) => {
            // Handle different history formats
            const i = item as unknown as
              | TransferHistoryItem
              | [unknown, { op: TransferHistoryItem['op']; timestamp: string; block: number; trx_id: string }];
            if (typeof i === 'object' && i !== null && 'op' in i) {
              return i as TransferHistoryItem;
            }
            const entry = (i as [unknown, { op: TransferHistoryItem['op']; timestamp: string; block: number; trx_id: string }])[1];
            return {
              op: entry.op,
              timestamp: entry.timestamp,
              block: entry.block,
              trx_id: entry.trx_id,
            } as TransferHistoryItem;
          })
          .reverse();

        setHistory(transfers);
      } catch (err) {
        console.error('Error fetching history:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [username, refreshNonce]);

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

  return (
    <div className="mt-8">
      <Separator className="mb-6" />
      <h4 className="text-lg font-bold mb-2 px-4">{t('history', { defaultMessage: 'History' })}</h4>
      <div className="secondary mb-4 px-4">
        <span>Beware of spam and phishing links in transfer memos. </span>
        <span>Do not open links from users you do not trust. </span>
        <span>Do not provide your private keys to any third party websites. </span>
        <span>Transactions will not show until they are confirmed on the blockchain, which may take a few minutes.</span>
      </div>
      <Table>
        <TableBody>
          {history.map((item, index) => {
            const row = formatTransferRow(item, username);
            return (
              <TableRow key={index}>
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
    </div>
  );
}
