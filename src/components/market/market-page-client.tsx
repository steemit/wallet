'use client';

import { Suspense, useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/login-form';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useSessionSigning } from '@/hooks/use-session-signing';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_LIMIT_ORDER_EXPIRATION_SEC,
  SBD_SYMBOL,
  STEEM_SYMBOL,
} from '@/lib/market/constants';
import { formatAssetAmount } from '@/lib/market/utils';
import { nextMarketOrderId } from '@/lib/market/order-id';
import { unixSecToSteemIsoTimestamp } from '@/lib/steem/chain-time';
import { invalidateWalletCache } from '@/lib/cache/client-invalidate';
import { apiClient } from '@/lib/steem/client';
import type { Operation } from '@/lib/steem/types';

export function MarketPageClient() {
  const t = useTranslations('wallet.marketPage');
  const tAuth = useTranslations('auth');
  const tWallet = useTranslations('wallet');
  const { username, isAuthenticated } = useAuth();
  // Unified signing entry (A6-T4): privateKey sessions sign through the
  // facade's legacy backend exactly as before (active key, owner fallback);
  // vault identity sessions get the per-key password dialog. `signing.dialog`
  // mounts it.
  const signing = useSessionSigning();
  const { data: account } = useSteemAccount(username ?? '');
  const { orderbook, ticker, history, openOrders, loading, error, refresh } =
    useMarketData(username);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  /** Classic re-auth for a privateKey session that lacks an active/owner key. */
  const [reauthOpen, setReauthOpen] = useState(false);

  const canTrade = isAuthenticated && !!username;

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
      if (!username) {
        toast.error(t('signInToTrade'));
        setLoginOpen(true);
        return;
      }

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

      // Unique per session (uint32, no same-second replacement on chain).
      const orderid = nextMarketOrderId();
      const expiration = Math.floor(Date.now() / 1000) + DEFAULT_LIMIT_ORDER_EXPIRATION_SEC;

      try {
        // The exact operation tuple SteemSigner.signLimitOrderCreate built
        // internally — field order, fill_or_kill default and the ISO
        // expiration conversion (condenser_api expects a time_point_sec
        // string, not unix seconds) are byte-identical.
        const operations: Operation[] = [
          [
            'limit_order_create',
            {
              owner: username,
              amount_to_sell: amountToSell,
              min_to_receive: minToReceive,
              fill_or_kill: false,
              expiration: unixSecToSteemIsoTimestamp(expiration),
              orderid,
            },
          ],
        ];

        // limit_order_create is an active-class operation.
        const outcome = await signing.sign({
          operations,
          accountName: username,
          role: 'active',
        });

        if (outcome.status === 'cancelled') {
          // User aborted the vault dialog — back to the form, no error.
          return;
        }
        if (outcome.status === 'needsClassicReauth') {
          // privateKey session without an active/owner key: the classic
          // re-auth dialog locked to this account.
          setReauthOpen(true);
          return;
        }
        if (outcome.status === 'error') {
          toast.error(t('orderFailed'));
          return;
        }

        const res = await apiClient.broadcastLimitOrderCreate(
          outcome.result.signedTx,
          username
        );
        if (!res.success) {
          toast.error(res.error ?? t('orderFailed'));
          return;
        }

        toast.success(t('orderPlaced', { summary: confirmText }));
        // Orders lock balances and change the extras open-orders list; drop the
        // L1 entries so returning to the wallet page shows fresh numbers.
        invalidateWalletCache(username);
        await refresh();
      } catch (err) {
        // Signing failures (missing key, header fetch error) and relay/network
        // failures must surface instead of dying as unhandled rejections.
        if (process.env.NODE_ENV !== 'production') console.error('Order error:', err);
        toast.error(t('orderFailed'));
      }
    },
    [username, t, refresh, signing]
  );

  const cancelOrder = useCallback(
    async (orderid: number) => {
      if (!username) return;
      if (!window.confirm(t('cancelConfirm', { orderId: orderid, user: username }))) return;
      setCancellingId(orderid);
      try {
        // The exact operation tuple SteemSigner.signLimitOrderCancel built.
        const operations: Operation[] = [
          ['limit_order_cancel', { owner: username, orderid }],
        ];

        // limit_order_cancel is an active-class operation.
        const outcome = await signing.sign({
          operations,
          accountName: username,
          role: 'active',
        });

        if (outcome.status === 'cancelled') {
          // User aborted the vault dialog — release the spinner, no error.
          return;
        }
        if (outcome.status === 'needsClassicReauth') {
          setReauthOpen(true);
          return;
        }
        if (outcome.status === 'error') {
          toast.error(t('orderFailed'));
          return;
        }

        const res = await apiClient.broadcastLimitOrderCancel(
          outcome.result.signedTx,
          username
        );
        if (!res.success) {
          toast.error(res.error ?? t('orderFailed'));
          return;
        }
        toast.success(t('orderCancelled', { orderId: orderid }));
        invalidateWalletCache(username);
        await refresh();
      } catch (err) {
        // Signing/relay errors must surface, not reject unhandled (the
        // try/finally alone only reset the spinner and rethrew).
        if (process.env.NODE_ENV !== 'production') console.error('Cancel order error:', err);
        toast.error(t('orderFailed'));
      } finally {
        setCancellingId(null);
      }
    },
    [username, t, refresh, signing]
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-10 md:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

      {!isAuthenticated && (
        <p className="text-muted-foreground rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          {t('signInToTrade')}{' '}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setLoginOpen(true)}
          >
            {tAuth('login')}
          </button>
        </p>
      )}

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tAuth('login')}</DialogTitle>
            <DialogDescription className="sr-only">{tAuth('login')}</DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="space-y-4 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            }
          >
            {/* Unauthenticated visitors may log in as any account; the
                active-authority requirement keeps a privateKey login fit for
                trading the first time (limit orders are active-class). In
                Vault Mode this dialog still offers identity selection — the
                per-action password dialog enforces the floor after login. */}
            <LoginForm
              embedded
              requiredAuthTypes={['active']}
              onLoginSuccess={() => setLoginOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
        <DialogContent className="z-[60] max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tWallet('reauthTitle')}</DialogTitle>
            <DialogDescription>{tWallet('reauthDescription')}</DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="space-y-4 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            }
          >
            <LoginForm
              embedded
              fixedUsername={username ?? ''}
              requiredAuthTypes={['active']}
              onLoginSuccess={() => setReauthOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>

      {signing.dialog}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
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

          <MarketDepthChart bids={orderbook.bids} asks={orderbook.asks} ticker={ticker} />

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
