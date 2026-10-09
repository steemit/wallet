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
import { normalizeSteemUsername } from '@/lib/steem/username';

export interface PendingConversion {
  requestid: number;
  amountSbd: number;
  finishTime: string;
}

export interface PendingSavingsWithdrawal {
  id: number;
  requestId: number;
  from: string;
  to: string;
  amount: string;
  memo: string;
  complete: string;
}

export interface WalletExtrasDetails {
  savingsPendingSteem: number;
  savingsPendingSbd: number;
  conversionTotalSbd: number;
  steemOrders: number;
  sbdOrders: number;
  conversions: PendingConversion[];
  savingsWithdrawals: PendingSavingsWithdrawal[];
}

/**
 * Extras state tagged with the identity it was fetched for. Consumers only
 * see the data while the tag matches the CURRENT username/options — a plain
 * state reset would need a synchronous effect write (and a plain "keep the
 * old state until the new fetch lands" leaks user A's pending conversions
 * and open-order totals into user B's wallet for the whole load window).
 */
interface ExtrasState {
  key: string;
  extras: WalletEstimateExtras;
  details: WalletExtrasDetails | null;
}

const EMPTY_EXTRAS: WalletEstimateExtras = {};

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
  const [extrasState, setExtrasState] = useState<ExtrasState>({
    key: '',
    extras: EMPTY_EXTRAS,
    details: null,
  });
  const [loading, setLoading] = useState(true);

  // Identity of the data currently being fetched: extras are user-specific
  // (and order totals depend on includeOpenOrders).
  const extrasKey = `${normalizeSteemUsername(username)}|${includeOpenOrders ? 1 : 0}`;

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
                conversions?: PendingConversion[];
                savingsWithdrawals?: PendingSavingsWithdrawal[];
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
            setExtrasState({
              key: extrasKey,
              extras: {
                savingsPendingSteem: extrasData.savingsPendingSteem ?? 0,
                savingsPendingSbd: extrasData.savingsPendingSbd ?? 0,
                conversionTotalSbd: extrasData.conversionTotalSbd ?? 0,
                steemOrders: extrasData.steemOrders ?? 0,
                sbdOrders: extrasData.sbdOrders ?? 0,
              },
              details: {
                savingsPendingSteem: extrasData.savingsPendingSteem ?? 0,
                savingsPendingSbd: extrasData.savingsPendingSbd ?? 0,
                conversionTotalSbd: extrasData.conversionTotalSbd ?? 0,
                steemOrders: extrasData.steemOrders ?? 0,
                sbdOrders: extrasData.sbdOrders ?? 0,
                conversions: extrasData.conversions ?? [],
                savingsWithdrawals: extrasData.savingsWithdrawals ?? [],
              },
            });
          } else {
            setExtrasState({ key: extrasKey, extras: EMPTY_EXTRAS, details: null });
          }
        }
      } catch (err) {
        console.error('Error fetching estimated account value:', err);
        if (!cancelled) {
          setPrices(null);
          setExtrasState({ key: extrasKey, extras: EMPTY_EXTRAS, details: null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // extrasKey is derived from username/includeOpenOrders (the effect deps).
  }, [username, includeOpenOrders, enabled, extrasKey]);

  // Only expose extras fetched for the CURRENT identity: on a username
  // switch the tag mismatches on the very first render of the new identity,
  // so user A's data disappears immediately instead of lingering until user
  // B's fetch lands.
  const extras = useMemo(
    () => (extrasState.key === extrasKey ? extrasState.extras : EMPTY_EXTRAS),
    [extrasState, extrasKey]
  );
  const details = extrasState.key === extrasKey ? extrasState.details : null;

  const valueUsd = useMemo(() => {
    if (!balance || !globalProps || !prices) return null;
    return computeEstimatedAccountValueUsd(balance, globalProps, prices, extras);
  }, [balance, globalProps, prices, extras]);

  const display = formatEstimatedAccountValueUsd(valueUsd);

  return { display, loading: loading && enabled, valueUsd, details };
}
