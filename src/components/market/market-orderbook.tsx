'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MarketOrderRow } from '@/lib/market/types';

const PAGE_SIZE = 10;

export function MarketOrderbook({
  side,
  orders,
  onPriceClick,
}: {
  side: 'bids' | 'asks';
  orders: MarketOrderRow[];
  onPriceClick: (price: number) => void;
}) {
  const t = useTranslations('wallet.marketPage');
  const buy = side === 'bids';
  const [page, setPage] = useState(0);

  const maxPage = Math.max(0, Math.ceil(orders.length / PAGE_SIZE) - 1);
  const pageIndex = Math.min(page, maxPage);
  const slice = orders.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  const rows = slice.reduce<{ order: MarketOrderRow; cumulative: number }[]>(
    (acc, order) => {
      const cumulative = (acc[acc.length - 1]?.cumulative ?? 0) + order.sbd;
      acc.push({ order, cumulative });
      return acc;
    },
    []
  );

  return (
    <div className="space-y-2">
      <Table className="text-right text-sm">
        <TableHeader>
          <TableRow>
            {buy ? (
              <>
                <TableHead className="text-right">{t('totalSbd')}</TableHead>
                <TableHead className="text-right">SBD ($)</TableHead>
                <TableHead className="text-right">STEEM</TableHead>
                <TableHead className="text-right">{t('price')}</TableHead>
              </>
            ) : (
              <>
                <TableHead className="text-right">{t('price')}</TableHead>
                <TableHead className="text-right">STEEM</TableHead>
                <TableHead className="text-right">SBD ($)</TableHead>
                <TableHead className="text-right">{t('totalSbd')}</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ order, cumulative }) => (
            <TableRow
              key={`${side}-${order.stringPrice}-${order.steem}`}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onPriceClick(order.price)}
            >
              {buy ? (
                <>
                  <TableCell>{cumulative.toFixed(3)}</TableCell>
                  <TableCell>{order.sbd.toFixed(3)}</TableCell>
                  <TableCell>{order.steem.toFixed(3)}</TableCell>
                  <TableCell className="text-emerald-600">${order.stringPrice}</TableCell>
                </>
              ) : (
                <>
                  <TableCell className="text-rose-600">${order.stringPrice}</TableCell>
                  <TableCell>{order.steem.toFixed(3)}</TableCell>
                  <TableCell>{order.sbd.toFixed(3)}</TableCell>
                  <TableCell>{cumulative.toFixed(3)}</TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          ← {buy ? t('higher') : t('lower')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= maxPage}
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
        >
          {buy ? t('lower') : t('higher')} →
        </Button>
      </div>
    </div>
  );
}
