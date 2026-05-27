import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { SteemService } from '@/lib/steem/server';
import { parseSteemAsset } from '@/lib/steem/parse-asset';
import { votesToSp } from '@/lib/proposals/utils';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', { maxRequests: 40, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(request.url);
    const proposalIdParam = searchParams.get('proposalId');
    const proposalId = proposalIdParam ? parseInt(proposalIdParam, 10) : NaN;
    if (!Number.isFinite(proposalId) || proposalId < 0) {
      return NextResponse.json({ error: 'Invalid proposalId' }, { status: 400 });
    }

    const cacheKey = `cache:query:proposals:votes:${proposalId}`;
    const result = await withCache(cacheKey, 20, 60, async () => {
      const allVotes: { voter: string; proposal: { proposal_id: number } }[] = [];
      let lastVoter = '';
      for (let page = 0; page < 10; page++) {
        const batch = await SteemService.listProposalVotesByProposal(proposalId, {
          lastVoter,
          limit: 1000,
        });
        if (batch.length === 0) break;
        const forProposal = batch.filter((v) => v.proposal?.proposal_id === proposalId);
        allVotes.push(...forProposal);
        if (batch.length < 1000) break;
        const last = batch[batch.length - 1];
        if (!last?.voter || last.voter === lastVoter) break;
        lastVoter = last.voter;
        if (batch.some((v) => v.proposal?.proposal_id !== proposalId)) break;
      }

      const voters = [...new Set(allVotes.map((v) => v.voter).filter(Boolean))];
      const globalProps = await SteemService.getGlobalProperties();
      const totalVestingShares = globalProps.total_vesting_shares ?? '0 VESTS';
      const totalVestingFundSteem = globalProps.total_vesting_fund_steem ?? '0 STEEM';

      const accounts =
        voters.length > 0 ? await SteemService.getAccounts(voters.slice(0, 200)) : [];
      const rows = accounts.map((acc) => {
        const ext = acc as typeof acc & { proxy?: string; proxied_vsf_votes?: string[] };
        const ownVests = parseSteemAsset(acc.vesting_shares);
        const proxied = (ext.proxied_vsf_votes ?? []).reduce(
          (sum, v) => sum + (typeof v === 'string' ? parseInt(v, 10) : Number(v) || 0),
          0
        );
        const totalVotes = ownVests + proxied;
        const sp = votesToSp(totalVotes, totalVestingShares, totalVestingFundSteem);
        return {
          voter: acc.name,
          sp: Number(sp.toFixed(2)),
          proxy: ext.proxy ?? '',
        };
      });

      rows.sort((a, b) => b.sp - a.sp);
      return { voters: rows };
    });

    return NextResponse.json({
      success: true,
      voters: result.data.voters,
      ...(result.degraded && { degraded: true }),
    });
  } catch (error) {
    console.error('Error fetching proposal voters:', error);
    return NextResponse.json({ error: 'Failed to fetch proposal voters' }, { status: 503 });
  }
}
