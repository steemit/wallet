'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MarketOrderRow } from '@/lib/market/types';
import {
  buildDepthChartModel,
  formatDepthTooltipSbd,
  formatDepthYAxisLabel,
  type DepthChartPoint,
} from '@/lib/market/depth-chart';

const BID_STROKE = 'rgb(0, 150, 0)';
const BID_FILL = 'rgba(0, 150, 0, 0.2)';
const ASK_STROKE = 'rgb(150, 0, 0)';
const ASK_FILL = 'rgba(150, 0, 0, 0.2)';

function DepthTooltip({
  active,
  payload,
  label,
  bidLabel,
  askLabel,
  priceLabel,
}: {
  active?: boolean;
  payload?: readonly { payload?: DepthChartPoint }[];
  label?: string | number;
  bidLabel: string;
  askLabel: string;
  priceLabel: string;
}) {
  if (!active || !payload?.length || label == null) return null;

  const price = Number(label);
  const row = payload[0]?.payload;

  return (
    <div className="rounded border border-border/80 bg-black/75 px-3 py-2 text-xs text-white shadow-md">
      <p className="mb-1">
        {priceLabel}: ${price.toFixed(6)}/STEEM
      </p>
      {row?.bidDepth != null && (
        <p style={{ color: BID_STROKE }}>
          {bidLabel}: <b>{formatDepthTooltipSbd(row.bidDepth)}</b>
        </p>
      )}
      {row?.askDepth != null && (
        <p style={{ color: ASK_STROKE }}>
          {askLabel}: <b>{formatDepthTooltipSbd(row.askDepth)}</b>
        </p>
      )}
    </div>
  );
}

export function MarketDepthChart({
  bids,
  asks,
}: {
  bids: MarketOrderRow[];
  asks: MarketOrderRow[];
}) {
  const t = useTranslations('wallet.marketPage');
  const model = useMemo(() => buildDepthChartModel(bids, asks), [bids, asks]);

  if (!model) return null;

  const { chartData, domain } = model;

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" />
          <XAxis
            type="number"
            dataKey="price"
            domain={[domain.min, domain.max]}
            tickFormatter={(v) => Number(v).toFixed(3)}
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            className="text-muted-foreground"
          />
          <YAxis
            tickFormatter={formatDepthYAxisLabel}
            tick={{ fontSize: 11 }}
            width={56}
            stroke="currentColor"
            className="text-muted-foreground"
          />
          <Tooltip
            isAnimationActive={false}
            content={
              <DepthTooltip
                bidLabel={t('bid')}
                askLabel={t('ask')}
                priceLabel={t('price')}
              />
            }
          />
          <Area
            type="stepAfter"
            dataKey="bidDepth"
            name={t('bid')}
            stroke={BID_STROKE}
            fill={BID_FILL}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Area
            type="stepBefore"
            dataKey="askDepth"
            name={t('ask')}
            stroke={ASK_STROKE}
            fill={ASK_FILL}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
