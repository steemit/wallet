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
import type { MarketTradeRow } from '@/lib/market/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

export function MarketTradeHistory({ history }: { history: MarketTradeRow[] }) {
  const t = useTranslations('wallet.marketPage');
  const [page, setPage] = useState(0);
  const maxPage = Math.max(0, Math.ceil(history.length / PAGE_SIZE) - 1);
  const pageIndex = Math.min(page, maxPage);
  const slice = history.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="space-y-2">
      <Table className="text-right text-sm">
        <TableHeader>
          <TableRow>
            <TableHead>{t('date')}</TableHead>
            <TableHead className="text-right">{t('price')}</TableHead>
            <TableHead className="text-right">STEEM</TableHead>
            <TableHead className="text-right">SBD ($)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((row) => (
            <TableRow key={`${row.date.getTime()}-${row.stringPrice}-${row.steem}`}>
              <TableCell className="text-left text-xs text-muted-foreground">
                {row.date.toLocaleString()}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right',
                  row.type === 'bid' ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                ${row.stringPrice}
              </TableCell>
              <TableCell>{row.steem.toFixed(3)}</TableCell>
              <TableCell>{row.sbd.toFixed(3)}</TableCell>
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
          ← {t('newer')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageIndex >= maxPage}
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
        >
          {t('older')} →
        </Button>
      </div>
    </div>
  );
}
