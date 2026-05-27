import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/middleware';
import { withCache } from '@/lib/cache/server-cache';
import { SteemService } from '@/lib/steem/server';
import { DAO_TREASURY_ACCOUNT } from '@/lib/proposals/constants';
import { computePaidProposalIds, numberWithCommas } from '@/lib/proposals/utils';
import { parseSteemAsset } from '@/lib/steem/parse-asset';

export async function GET(request: NextRequest) {
  try {
    const rateLimitError = await rateLimit(request, 'query', { maxRequests: 30, windowSeconds: 60 });
    if (rateLimitError) return rateLimitError;

    const result = await withCache('cache:query:proposals:dao-stats', 30, 120, async () => {
      const accounts = await SteemService.getAccounts([DAO_TREASURY_ACCOUNT]);
      const balance = parseSteemAsset(accounts[0]?.sbd_balance ?? 0);
      const dailyBudgetNum = balance / 100;
      const daoTreasury = numberWithCommas(balance.toFixed(3));
      const dailyBudget = numberWithCommas(dailyBudgetNum.toFixed(3));

      const active = await SteemService.listProposals({
        start: [-1, 0],
        limit: 1000,
        order: 'by_total_votes',
        order_direction: 'descending',
        status: 'active',
      });
      const paidProposalIds = computePaidProposalIds(active, dailyBudgetNum);

      let treasuryFeeSbd: string | null = null;
      try {
        const config = await SteemService.getChainConfig();
        const fee = config.STEEM_TREASURY_FEE;
        if (typeof fee === 'number' && Number.isFinite(fee)) {
          treasuryFeeSbd = numberWithCommas((fee / 1000).toFixed(3));
        }
      } catch {
        treasuryFeeSbd = null;
      }

      return { daoTreasury, dailyBudget, paidProposalIds, treasuryFeeSbd };
    });

    const response = NextResponse.json({ success: true, ...result.data });
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    if (result.degraded) response.headers.set('X-Degraded', 'true');
    return response;
  } catch (error) {
    console.error('Error fetching DAO stats:', error);
    return NextResponse.json({ error: 'Failed to fetch DAO stats', degraded: true }, { status: 503 });
  }
}
