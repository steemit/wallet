'use client';

import { useTranslations } from 'next-intl';
import type { MarketTicker } from '@/lib/market/types';
import { marketSpreadPercent } from '@/lib/market/utils';
import { cn } from '@/lib/utils';

export function MarketTickerBar({ ticker }: { ticker: MarketTicker }) {
  const t = useTranslations('wallet.marketPage');
  const spread = marketSpreadPercent(ticker);
  const pctUp = ticker.percent_change >= 0;

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
      <li>
        <b className="text-foreground">{t('lastPrice')}</b>{' '}
        <span className="text-muted-foreground">
          ${ticker.latest.toFixed(6)}{' '}
          <span className={cn(pctUp ? 'text-emerald-600' : 'text-rose-600')}>
            ({pctUp ? '+' : ''}
            {ticker.percent_change.toFixed(2)}%)
          </span>
        </span>
      </li>
      <li>
        <b className="text-foreground">{t('volume24h')}</b>{' '}
        <span className="text-muted-foreground">${ticker.sbd_volume.toFixed(2)}</span>
      </li>
      <li>
        <b className="text-foreground">{t('bid')}</b>{' '}
        <span className="text-muted-foreground">${ticker.highest_bid.toFixed(6)}</span>
      </li>
      <li>
        <b className="text-foreground">{t('ask')}</b>{' '}
        <span className="text-muted-foreground">${ticker.lowest_ask.toFixed(6)}</span>
      </li>
      {spread !== null && ticker.highest_bid > 0 && (
        <li>
          <b className="text-foreground">{t('spread')}</b>{' '}
          <span className="text-muted-foreground">{spread.toFixed(3)}%</span>
        </li>
      )}
    </ul>
  );
}
