'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/steem/client';
import type {
  GlobalProperties,
  Proposal,
  ProposalOrderBy,
  ProposalOrderDirection,
  ProposalStatus,
} from '@/lib/steem/types';

type ProposalSnapshot = {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  limit: number;
  status: ProposalStatus;
  order: ProposalOrderBy;
  direction: ProposalOrderDirection;
  globalProps: GlobalProperties | null;
};

const defaultSnapshot = (): ProposalSnapshot => ({
  proposals: [],
  loading: true,
  error: null,
  limit: 50,
  status: 'votable',
  order: 'by_total_votes',
  direction: 'descending',
  globalProps: null,
});

export function useProposals(username: string | null) {
  const [snapshot, setSnapshot] = useState<ProposalSnapshot>(defaultSnapshot);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      status: snapshot.status,
      order: snapshot.order,
      direction: snapshot.direction,
      limit: String(snapshot.limit),
    });
    if (username) params.set('username', username);
    return params.toString();
  }, [snapshot.status, snapshot.order, snapshot.direction, snapshot.limit, username]);

  const refresh = useCallback(async () => {
    setSnapshot((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [proposalsRes, globalRes] = await Promise.all([
        fetch(`/api/query/proposals?${queryString}`).then(
          (r) =>
            r.json() as Promise<{
              success?: boolean;
              proposals?: Proposal[];
              error?: string;
            }>
        ),
        apiClient.getGlobalProps(),
      ]);

      if (!proposalsRes.success || !Array.isArray(proposalsRes.proposals)) {
        setSnapshot((prev) => ({
          ...prev,
          loading: false,
          error: proposalsRes.error ?? 'Failed to load proposals',
        }));
        return;
      }

      setSnapshot((prev) => ({
        ...prev,
        proposals: proposalsRes.proposals ?? [],
        globalProps: globalRes.props ?? null,
        loading: false,
        error: null,
      }));
    } catch (err) {
      setSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load proposals',
      }));
    }
  }, [queryString]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = useCallback((status: ProposalStatus) => {
    setSnapshot((prev) => ({ ...prev, status, limit: 50 }));
  }, []);

  const setOrder = useCallback((order: ProposalOrderBy) => {
    setSnapshot((prev) => ({ ...prev, order, limit: 50 }));
  }, []);

  const setDirection = useCallback((direction: ProposalOrderDirection) => {
    setSnapshot((prev) => ({ ...prev, direction, limit: 50 }));
  }, []);

  const loadMore = useCallback(() => {
    setSnapshot((prev) => ({ ...prev, limit: Math.min(prev.limit + 50, 200) }));
  }, []);

  return {
    ...snapshot,
    refresh,
    setStatus,
    setOrder,
    setDirection,
    loadMore,
  };
}

