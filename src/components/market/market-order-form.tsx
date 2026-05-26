'use client';

import { FormEvent, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketTicker } from '@/lib/market/types';
import { percentDiff, roundDown, roundUp } from '@/lib/market/utils';
import { cn } from '@/lib/utils';

export type MarketOrderSide = 'buy' | 'sell';

export function MarketOrderForm({
  side,
  ticker,
  steemBalance,
  sbdBalance,
  disabled,
  externalPrice,
  onSubmit,
}: {
  side: MarketOrderSide;
  ticker: MarketTicker | null;
  steemBalance: string | null;
  sbdBalance: string | null;
  disabled: boolean;
  externalPrice?: number | null;
  onSubmit: (payload: {
    price: number;
    amount: number;
    total: number;
    priceWarning: boolean;
    marketRefPrice: number;
  }) => Promise<void>;
}) {
  const t = useTranslations('wallet.marketPage');
  const isBuy = side === 'buy';
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [total, setTotal] = useState('');
  const [priceWarning, setPriceWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const priceId = useId();
  const amountId = useId();
  const totalId = useId();
  const [tickerSeeded, setTickerSeeded] = useState(false);
  const [lastExternalPrice, setLastExternalPrice] = useState<number | null>(null);

  const validate = (p: number, a: number, tot: number) => {
    if (!(p > 0 && a > 0 && tot > 0)) {
      setPriceWarning(false);
      return false;
    }
    if (!ticker) return true;
    if (isBuy) {
      setPriceWarning(percentDiff(ticker.lowest_ask, p) > 15);
    } else {
      setPriceWarning(percentDiff(ticker.highest_bid, p) < -15);
    }
    return true;
  };

  const applyPrice = (p: number) => {
    setPrice(p.toFixed(6));
    const a = parseFloat(amount);
    const nextTotal =
      a >= 0
        ? (isBuy ? roundUp(p * a, 3) : roundDown(p * a, 3)).toFixed(3)
        : total;
    if (a >= 0) setTotal(nextTotal);
    validate(p, a, parseFloat(nextTotal));
  };

  if (ticker && !tickerSeeded) {
    setTickerSeeded(true);
    applyPrice(isBuy ? ticker.lowest_ask : ticker.highest_bid);
  }

  if (
    externalPrice != null &&
    externalPrice > 0 &&
    externalPrice !== lastExternalPrice
  ) {
    setLastExternalPrice(externalPrice);
    applyPrice(externalPrice);
  }

  const onPriceChange = (value: string) => {
    setPrice(value);
    const p = parseFloat(value);
    const a = parseFloat(amount);
    if (p >= 0 && a >= 0) {
      setTotal((isBuy ? roundUp(p * a, 3) : roundDown(p * a, 3)).toFixed(3));
    }
    validate(p, a, parseFloat(total));
  };

  const onAmountChange = (value: string) => {
    setAmount(value);
    const p = parseFloat(price);
    const a = parseFloat(value);
    if (p >= 0 && a >= 0) {
      setTotal((isBuy ? roundUp(p * a, 3) : roundDown(p * a, 3)).toFixed(3));
    }
    validate(p, a, parseFloat(total));
  };

  const onTotalChange = (value: string) => {
    setTotal(value);
    const p = parseFloat(price);
    const tot = parseFloat(value);
    if (p >= 0 && tot >= 0) {
      setAmount((isBuy ? roundUp(tot / p, 3) : roundDown(tot / p, 3)).toFixed(3));
    }
    validate(p, parseFloat(amount), tot);
  };

  const fillAvailable = () => {
    if (isBuy && sbdBalance) {
      const tot = sbdBalance.split(' ')[0] ?? '0';
      setTotal(tot);
      const p = parseFloat(price);
      if (p > 0) setAmount(roundDown(parseFloat(tot) / p, 3).toFixed(3));
    } else if (!isBuy && steemBalance) {
      const amt = steemBalance.split(' ')[0] ?? '0';
      setAmount(amt);
      const p = parseFloat(price);
      if (p > 0) setTotal(roundDown(p * parseFloat(amt), 3).toFixed(3));
    }
    validate(parseFloat(price), parseFloat(amount), parseFloat(total));
  };

  const snapMarketPrice = () => {
    if (!ticker) return;
    const ref = isBuy ? ticker.lowest_ask : ticker.highest_bid;
    setPrice(ref.toFixed(6));
    const a = parseFloat(amount);
    if (a >= 0) {
      setTotal((isBuy ? roundUp(ref * a, 3) : roundDown(ref * a, 3)).toFixed(3));
    }
    validate(ref, a, parseFloat(total));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const p = parseFloat(price);
    const a = parseFloat(amount);
    const tot = parseFloat(total);
    if (!validate(p, a, tot) || !(p > 0 && a > 0 && tot > 0)) return;
    setSubmitting(true);
    try {
      await onSubmit({
        price: p,
        amount: a,
        total: tot,
        priceWarning,
        marketRefPrice: isBuy ? (ticker?.lowest_ask ?? p) : (ticker?.highest_bid ?? p),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !disabled && parseFloat(price) > 0 && parseFloat(amount) > 0 && parseFloat(total) > 0;

  return (
    <form className="space-y-4 rounded-lg border border-border p-4" onSubmit={handleSubmit}>
      <h3
        className={cn(
          'text-sm font-semibold uppercase tracking-wide',
          isBuy ? 'text-emerald-600' : 'text-rose-600'
        )}
      >
        {isBuy ? t('buySteem') : t('sellSteem')}
      </h3>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <Label htmlFor={priceId}>{t('price')}</Label>
        <div className="flex gap-2">
          <Input
            id={priceId}
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            disabled={disabled || submitting}
            className={cn(priceWarning && 'border-amber-500 bg-amber-500/10')}
          />
          <span className="flex items-center text-xs text-muted-foreground whitespace-nowrap">
            SBD/STEEM
          </span>
        </div>

        <Label htmlFor={amountId}>{t('amount')}</Label>
        <div className="flex gap-2">
          <Input
            id={amountId}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            disabled={disabled || submitting}
          />
          <span className="flex items-center text-xs text-muted-foreground">STEEM</span>
        </div>

        <Label htmlFor={totalId}>{t('total')}</Label>
        <div className="flex gap-2">
          <Input
            id={totalId}
            value={total}
            onChange={(e) => onTotalChange(e.target.value)}
            disabled={disabled || submitting}
          />
          <span className="flex items-center text-xs text-muted-foreground">SBD ($)</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-xs text-muted-foreground">
          {steemBalance && sbdBalance && (
            <p>
              <button type="button" className="text-primary hover:underline" onClick={fillAvailable}>
                {t('available')}:
              </button>{' '}
              {isBuy ? sbdBalance : steemBalance}
            </p>
          )}
          {ticker && (
            <p>
              <button type="button" className="text-primary hover:underline" onClick={snapMarketPrice}>
                {isBuy ? t('lowestAsk') : t('highestBid')}:
              </button>{' '}
              {(isBuy ? ticker.lowest_ask : ticker.highest_bid).toFixed(6)}
            </p>
          )}
        </div>
        <Button
          type="submit"
          disabled={!canSubmit || submitting}
          variant={isBuy ? 'default' : 'destructive'}
          className={cn(isBuy && 'bg-emerald-600 hover:bg-emerald-700')}
        >
          {isBuy ? t('buySteem') : t('sellSteem')}
        </Button>
      </div>
    </form>
  );
}
