'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  // Race guard (docs/AI-driver/06 rule 1): only the newest request's
  // response may write the snapshot — an older query's response (previous
  // filter/username) arriving late must not overwrite the current list.
  const requestIdRef = useRef(0);

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

  const refresh = useCallback(async (opts?: { noStore?: boolean }) => {
    // Latest request wins: each refresh supersedes any still in flight.
    const requestId = ++requestIdRef.current;
    setSnapshot((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [proposalsRes, globalRes] = await Promise.all([
        // The route serves username'd responses with `private, max-age=15`;
        // `noStore` skips the HTTP cache so a post-vote refresh cannot echo
        // the pre-vote upVoted flags for up to 15s.
        fetch(
          `/api/query/proposals?${queryString}`,
          opts?.noStore ? { cache: 'no-store' as const } : undefined
        ).then(
          (r) =>
            r.json() as Promise<{
              success?: boolean;
              proposals?: Proposal[];
              error?: string;
            }>
        ),
        apiClient.getGlobalProps(),
      ]);

      if (requestId !== requestIdRef.current) return;

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
      if (requestId !== requestIdRef.current) return;
      setSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load proposals',
      }));
    }
  }, [queryString]);

  /**
   * Optimistic local vote flip (see K-3): set the user's own upVoted flag
   * immediately; the caller rolls it back by passing the previous value if
   * the broadcast fails.
   */
  const setProposalVotedLocally = useCallback((proposalId: number, upVoted: boolean) => {
    setSnapshot((prev) => ({
      ...prev,
      proposals: prev.proposals.map((p) =>
        p.proposal_id === proposalId ? { ...p, upVoted } : p
      ),
    }));
  }, []);

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
    setProposalVotedLocally,
    setStatus,
    setOrder,
    setDirection,
    loadMore,
  };
}

