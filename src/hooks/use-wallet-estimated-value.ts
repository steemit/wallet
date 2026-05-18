'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  computeEstimatedAccountValueUsd,
  formatEstimatedAccountValueUsd,
  type WalletEstimateExtras,
  type WalletPrices,
} from '@/lib/wallet/estimated-account-value';
import type { GlobalPropsData, WalletBalanceData } from '@/lib/wallet/wallet-balance-types';
import { cachedFetch } from '@/lib/cache/client-fetch';

export function useWalletEstimatedValue({
  username,
  balance,
  globalProps,
  includeOpenOrders = false,
  enabled = true,
}: {
  username: string;
  balance: WalletBalanceData | null;
  globalProps: GlobalPropsData | null;
  includeOpenOrders?: boolean;
  enabled?: boolean;
}) {
  const [prices, setPrices] = useState<WalletPrices | null>(null);
  const [extras, setExtras] = useState<WalletEstimateExtras>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Bail without writing state: the returned `loading: loading && enabled`
    // already hides any stale `true` while the hook is disabled, and writing
    // state synchronously at the top of an effect trips
    // react-hooks/set-state-in-effect.
    if (!enabled) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [pricesResult, extrasResult] = await Promise.all([
          cachedFetch<{
            success?: boolean;
            steemPrice?: number;
            sbdPrice?: number;
          }>('/api/query/wallet-prices', { staleMs: 30_000, maxAgeMs: 120_000 }),
          username
            ? cachedFetch<{
                success?: boolean;
                savingsPendingSteem?: number;
                savingsPendingSbd?: number;
                conversionTotalSbd?: number;
                steemOrders?: number;
                sbdOrders?: number;
              }>(
                `/api/query/wallet-estimate-extras?username=${encodeURIComponent(username)}&includeOpenOrders=${includeOpenOrders}`,
                { staleMs: 30_000, maxAgeMs: 120_000 }
              )
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        const pricesData = pricesResult.data;
        if (pricesData.success) {
          setPrices({
            steemPrice: pricesData.steemPrice ?? 0,
            sbdPrice: pricesData.sbdPrice ?? 0,
          });
        } else {
          setPrices(null);
        }

        if (extrasResult) {
          const extrasData = extrasResult.data;
          if (extrasData.success) {
            setExtras({
              savingsPendingSteem: extrasData.savingsPendingSteem ?? 0,
              savingsPendingSbd: extrasData.savingsPendingSbd ?? 0,
              conversionTotalSbd: extrasData.conversionTotalSbd ?? 0,
              steemOrders: extrasData.steemOrders ?? 0,
              sbdOrders: extrasData.sbdOrders ?? 0,
            });
          } else {
            setExtras({});
          }
        }
      } catch (err) {
        console.error('Error fetching estimated account value:', err);
        if (!cancelled) {
          setPrices(null);
          setExtras({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [username, includeOpenOrders, enabled]);

  const valueUsd = useMemo(() => {
    if (!balance || !globalProps || !prices) return null;
    return computeEstimatedAccountValueUsd(balance, globalProps, prices, extras);
  }, [balance, globalProps, prices, extras]);

  const display = formatEstimatedAccountValueUsd(valueUsd);

  return { display, loading: loading && enabled, valueUsd };
}
