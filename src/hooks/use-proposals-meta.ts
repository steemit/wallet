'use client';

import { useCallback, useEffect, useState } from 'react';

type ProposalsMeta = {
  daoTreasury: string | null;
  dailyBudget: string | null;
  paidProposalIds: number[];
  treasuryFeeSbd: string | null;
  loading: boolean;
  /** '' while fine; short message after a failed fetch (sibling-hook contract). */
  error: string;
};

/**
 * DAO treasury / daily budget header data for the proposals page. Errors
 * are surfaced through `error` (previously swallowed entirely, leaving the
 * header silently blank with no way to tell a failure from empty data);
 * the header UI does not render the message yet.
 */
export function useProposalsMeta() {
  const [meta, setMeta] = useState<ProposalsMeta>({
    daoTreasury: null,
    dailyBudget: null,
    paidProposalIds: [],
    treasuryFeeSbd: null,
    loading: true,
    error: '',
  });

  const refresh = useCallback(async () => {
    setMeta((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetch('/api/query/proposals/dao-stats').then(
        (r) =>
          r.json() as Promise<{
            success?: boolean;
            error?: string;
            daoTreasury?: string;
            dailyBudget?: string;
            paidProposalIds?: number[];
            treasuryFeeSbd?: string;
          }>
      );
      if (!res.success) {
        setMeta((prev) => ({
          ...prev,
          loading: false,
          error: res.error || 'Failed to fetch proposals overview',
        }));
        return;
      }
      setMeta({
        daoTreasury: res.daoTreasury ?? null,
        dailyBudget: res.dailyBudget ?? null,
        paidProposalIds: res.paidProposalIds ?? [],
        treasuryFeeSbd: res.treasuryFeeSbd ?? null,
        loading: false,
        error: '',
      });
    } catch {
      setMeta((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to fetch proposals overview',
      }));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { ...meta, refreshMeta: refresh };
}
