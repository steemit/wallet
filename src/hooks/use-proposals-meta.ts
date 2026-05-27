'use client';

import { useCallback, useEffect, useState } from 'react';

type ProposalsMeta = {
  daoTreasury: string | null;
  dailyBudget: string | null;
  paidProposalIds: number[];
  treasuryFeeSbd: string | null;
  loading: boolean;
};

export function useProposalsMeta() {
  const [meta, setMeta] = useState<ProposalsMeta>({
    daoTreasury: null,
    dailyBudget: null,
    paidProposalIds: [],
    treasuryFeeSbd: null,
    loading: true,
  });

  const refresh = useCallback(async () => {
    setMeta((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/query/proposals/dao-stats').then(
        (r) =>
          r.json() as Promise<{
            success?: boolean;
            daoTreasury?: string;
            dailyBudget?: string;
            paidProposalIds?: number[];
            treasuryFeeSbd?: string;
          }>
      );
      if (!res.success) {
        setMeta((prev) => ({ ...prev, loading: false }));
        return;
      }
      setMeta({
        daoTreasury: res.daoTreasury ?? null,
        dailyBudget: res.dailyBudget ?? null,
        paidProposalIds: res.paidProposalIds ?? [],
        treasuryFeeSbd: res.treasuryFeeSbd ?? null,
        loading: false,
      });
    } catch {
      setMeta((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { ...meta, refreshMeta: refresh };
}
