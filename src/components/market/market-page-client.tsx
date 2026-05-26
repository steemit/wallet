'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth, useActiveSigningKey } from '@/hooks/use-auth';
import { useMarketData } from '@/hooks/use-market-data';
import { useSteemAccount } from '@/hooks/use-steem-account';
import { MarketDepthChart } from '@/components/market/market-depth-chart';
import { MarketTickerBar } from '@/components/market/market-ticker';
import { MarketOrderForm } from '@/components/market/market-order-form';
import { MarketOrderbook } from '@/components/market/market-orderbook';
import { MarketTradeHistory } from '@/components/market/market-trade-history';
import { MarketOpenOrders } from '@/components/market/market-open-orders';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DEFAULT_LIMIT_ORDER_EXPIRATION_SEC,
  SBD_SYMBOL,
  STEEM_SYMBOL,
} from '@/lib/market/constants';
import { formatAssetAmount } from '@/lib/market/utils';
import { apiClient, SteemSigner } from '@/lib/steem/client';

export function MarketPageClient() {
  const t = useTranslations('wallet.marketPage');
  const tAuth = useTranslations('auth');
  const { username, isAuthenticated } = useAuth();
  const activeKey = useActiveSigningKey();
  const { data: account } = useSteemAccount(username ?? '');
  const { orderbook, ticker, history, openOrders, loading, error, refresh } =
    useMarketData(username);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const canTrade = isAuthenticated && !!username && !!activeKey;

  const placeOrder = useCallback(
    async (
      side: 'buy' | 'sell',
      payload: {
        price: number;
        amount: number;
        total: number;
        priceWarning: boolean;
        marketRefPrice: number;
      }
    ) => {
      if (!username || !activeKey) {
        setNotice({ type: 'error', text: t('signInToTrade') });
        return;
      }
      setNotice(null);

      const isSell = side === 'sell';
      const amountToSell = isSell
        ? formatAssetAmount(payload.amount, STEEM_SYMBOL)
        : formatAssetAmount(payload.total, SBD_SYMBOL);
      const minToReceive = isSell
        ? formatAssetAmount(payload.total, SBD_SYMBOL)
        : formatAssetAmount(payload.amount, STEEM_SYMBOL);
      const effectivePrice = `$${payload.price.toFixed(6)}/STEEM`;

      let confirmText = isSell
        ? t('sellConfirm', { amountToSell, minToReceive, effectivePrice })
        : t('buyConfirm', { amountToSell, minToReceive, effectivePrice });

      if (payload.priceWarning) {
        const warning = isSell
          ? t('priceWarningBelow', {
              marketPrice: `$${payload.marketRefPrice.toFixed(4)}/STEEM`,
            })
          : t('priceWarningAbove', {
              marketPrice: `$${payload.marketRefPrice.toFixed(4)}/STEEM`,
            });
        confirmText = `${warning}\n\n${confirmText}`;
      }

      if (!window.confirm(`${confirmText}?`)) return;

      const orderid = Math.floor(Date.now() / 1000);
      const expiration = Math.floor(Date.now() / 1000) + DEFAULT_LIMIT_ORDER_EXPIRATION_SEC;

      const signedTx = await SteemSigner.signLimitOrderCreate(
        username,
        amountToSell,
        minToReceive,
        orderid,
        expiration,
        activeKey
      );

      const res = await apiClient.broadcastLimitOrderCreate(signedTx, username);
      if (!res.success) {
        setNotice({ type: 'error', text: res.error ?? res.details ?? t('orderFailed') });
        return;
      }

      setNotice({ type: 'success', text: t('orderPlaced', { summary: confirmText }) });
      await refresh();
    },
    [username, activeKey, t, refresh]
  );

  const cancelOrder = useCallback(
    async (orderid: number) => {
      if (!username || !activeKey) return;
      if (!window.confirm(t('cancelConfirm', { orderId: orderid, user: username }))) return;
      setCancellingId(orderid);
      try {
        const signedTx = await SteemSigner.signLimitOrderCancel(username, orderid, activeKey);
        const res = await apiClient.broadcastLimitOrderCancel(signedTx, username);
        if (!res.success) {
          setNotice({ type: 'error', text: res.error ?? res.details ?? t('orderFailed') });
          return;
        }
        setNotice({ type: 'success', text: t('orderCancelled', { orderId: orderid }) });
        await refresh();
      } finally {
        setCancellingId(null);
      }
    },
    [username, activeKey, t, refresh]
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      {!isAuthenticated && (
        <p className="text-muted-foreground rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          {t('signInToTrade')}{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {tAuth('login')}
          </Link>
        </p>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p
          className={
            notice.type === 'success'
              ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200'
              : 'text-destructive rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm'
          }
          role="status"
        >
          {notice.text}
        </p>
      )}

      {loading && !ticker ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : ticker ? (
        <>
          <MarketTickerBar ticker={ticker} />

          <MarketDepthChart bids={orderbook.bids} asks={orderbook.asks} />

          <div className="grid gap-6 lg:grid-cols-2">
            <MarketOrderForm
              side="buy"
              ticker={ticker}
              steemBalance={account?.balance ?? null}
              sbdBalance={account?.sbd_balance ?? null}
              disabled={!canTrade}
              externalPrice={selectedPrice}
              onSubmit={(p) => placeOrder('buy', p)}
            />
            <MarketOrderForm
              side="sell"
              ticker={ticker}
              steemBalance={account?.balance ?? null}
              sbdBalance={account?.sbd_balance ?? null}
              disabled={!canTrade}
              externalPrice={selectedPrice}
              onSubmit={(p) => placeOrder('sell', p)}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <h4 className="mb-3 font-semibold">{t('buyOrders')}</h4>
              <MarketOrderbook
                side="bids"
                orders={orderbook.bids}
                onPriceClick={setSelectedPrice}
              />
            </div>
            <div>
              <h4 className="mb-3 font-semibold">{t('sellOrders')}</h4>
              <MarketOrderbook
                side="asks"
                orders={orderbook.asks}
                onPriceClick={setSelectedPrice}
              />
            </div>
            <div>
              <h4 className="mb-3 font-semibold">{t('tradeHistory')}</h4>
              <MarketTradeHistory history={history} />
            </div>
          </div>

          {isAuthenticated && username && (
            <div>
              <h4 className="mb-3 font-semibold">{t('openOrders')}</h4>
              <MarketOpenOrders
                orders={openOrders}
                onCancel={cancelOrder}
                cancellingId={cancellingId}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
