// GET /api/query/proposals?status=votable&order=by_total_votes&direction=descending&limit=50&username=alice
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { SteemService } from '@/lib/steem/server';
import type { ProposalOrderBy, ProposalOrderDirection, ProposalStatus } from '@/lib/steem/types';

function asOrderBy(value: string | null): ProposalOrderBy {
  const allowed: ProposalOrderBy[] = ['by_total_votes', 'by_creator', 'by_start_date', 'by_end_date'];
  return allowed.includes(value as ProposalOrderBy) ? (value as ProposalOrderBy) : 'by_total_votes';
}

function asDirection(value: string | null): ProposalOrderDirection {
  return value === 'ascending' || value === 'descending' ? value : 'descending';
}

function asStatus(value: string | null): ProposalStatus {
  const allowed: ProposalStatus[] = ['all', 'inactive', 'active', 'expired', 'votable', 'disabled'];
  return allowed.includes(value as ProposalStatus) ? (value as ProposalStatus) : 'votable';
}

function startFor(order: ProposalOrderBy, direction: ProposalOrderDirection): unknown[] {
  const minDate = '1970-01-01T00:00:00';
  const maxDate = '2038-01-19T03:14:07';
  if (order === 'by_creator') return direction === 'ascending' ? [''] : ['zzzzzzzzzzzzzz'];
  if (order === 'by_start_date') return direction === 'ascending' ? [minDate] : [maxDate];
  if (order === 'by_end_date') return direction === 'ascending' ? [minDate] : [maxDate];
  return direction === 'ascending' ? [0] : [-1, 0];
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', { maxRequests: 60, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const status = asStatus(searchParams.get('status'));
    const order = asOrderBy(searchParams.get('order'));
    const direction = asDirection(searchParams.get('direction'));
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const username = searchParams.get('username')?.trim();

    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return NextResponse.json({ error: 'Limit must be between 1 and 200' }, { status: 400 });
    }

    const cacheKey = [
      'cache:query:proposals',
      status,
      order,
      direction,
      String(limit),
      username ? `u:${username}` : 'u:-',
    ].join(':');

    const result = await withCache(cacheKey, 15, 120, async () => {
      const proposals = await SteemService.listProposals({
        start: startFor(order, direction),
        limit,
        order,
        order_direction: direction,
        status,
      });

      if (!username) return { proposals };

      const votes = await SteemService.listProposalVotesByVoter(username);
      const voted = new Set<number>();
      for (const vote of votes) {
        if (vote?.voter !== username) break;
        const proposalId = vote?.proposal?.proposal_id;
        if (typeof proposalId === 'number') voted.add(proposalId);
      }
      const munged = proposals.map((p) => ({ ...p, upVoted: voted.has(p.proposal_id) }));
      return { proposals: munged };
    });

    const response = NextResponse.json({
      success: true,
      proposals: result.data.proposals,
      ...(result.degraded && { degraded: true, staleAge: result.staleAge }),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=120');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching proposals:', error);
    return NextResponse.json({ error: 'Failed to fetch proposals', degraded: true }, { status: 503 });
  }
}

