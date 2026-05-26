'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { MarketOpenOrderRow, OpenOrdersSortColumn } from '@/lib/market/types';
import { cn } from '@/lib/utils';

type SortState = { column: OpenOrdersSortColumn; dir: 1 | -1 };

export function MarketOpenOrders({
  orders,
  onCancel,
  cancellingId,
}: {
  orders: MarketOpenOrderRow[];
  onCancel: (orderid: number) => void;
  cancellingId: number | null;
}) {
  const t = useTranslations('wallet.marketPage');
  const [sort, setSort] = useState<SortState>({ column: 'created', dir: -1 });

  const sorted = useMemo(() => {
    const copy = [...orders];
    copy.sort((a, b) => {
      const col = sort.column;
      const av = a[col];
      const bv = b[col];
      if (av < bv) return -1 * sort.dir;
      if (av > bv) return 1 * sort.dir;
      return 0;
    });
    return copy;
  }, [orders, sort]);

  const toggleSort = (column: OpenOrdersSortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: (prev.dir === 1 ? -1 : 1) as 1 | -1 }
        : { column, dir: -1 }
    );
  };

  const sortableClass = (column: OpenOrdersSortColumn) =>
    cn(
      'cursor-pointer select-none hover:text-foreground',
      sort.column === column && 'text-foreground font-semibold'
    );

  if (orders.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('noOpenOrders')}</p>;
  }

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          <TableHead className={sortableClass('created')} onClick={() => toggleSort('created')}>
            {t('dateCreated')}
          </TableHead>
          <TableHead className={sortableClass('type')} onClick={() => toggleSort('type')}>
            {t('type')}
          </TableHead>
          <TableHead className={sortableClass('price')} onClick={() => toggleSort('price')}>
            {t('price')}
          </TableHead>
          <TableHead className={sortableClass('steem')} onClick={() => toggleSort('steem')}>
            STEEM
          </TableHead>
          <TableHead className={sortableClass('sbd')} onClick={() => toggleSort('sbd')}>
            SBD ($)
          </TableHead>
          <TableHead>{t('action')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((order) => (
          <TableRow key={order.orderid}>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(order.created).toLocaleString()}
            </TableCell>
            <TableCell className={order.type === 'bid' ? 'text-emerald-600' : 'text-rose-600'}>
              {order.type === 'bid' ? t('buy') : t('sell')}
            </TableCell>
            <TableCell>${order.price.toFixed(6)}</TableCell>
            <TableCell>{order.steem.toFixed(3)}</TableCell>
            <TableCell>{order.sbd.toFixed(3)}</TableCell>
            <TableCell>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                disabled={cancellingId === order.orderid}
                onClick={() => onCancel(order.orderid)}
              >
                {t('cancelOrder')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
