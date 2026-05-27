import { parseSteemAsset } from '@/lib/steem/parse-asset';
import type { Proposal } from '@/lib/steem/types';
import { DAO_TREASURY_ACCOUNT, PROPOSAL_BURN_ACCOUNTS } from '@/lib/proposals/constants';

export function numberWithCommas(value: string | number): string {
  const parts = String(value).split('.');
  const head = parts[0] ?? '0';
  parts[0] = head.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function abbreviateNumber(value: number): string {
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
}

export function proposalDateMs(iso: string): number {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

export type ProposalLifecycle = 'not_started' | 'started' | 'finished';

export function proposalLifecycle(startIso: string, endIso: string): ProposalLifecycle {
  const now = Date.now();
  const start = proposalDateMs(startIso);
  const end = proposalDateMs(endIso);
  if (end <= now) return 'finished';
  if (start <= now) return 'started';
  return 'not_started';
}

export function proposalFundingType(receiver: string): 'refund' | 'burn' | null {
  if (receiver === DAO_TREASURY_ACCOUNT) return 'refund';
  if (PROPOSAL_BURN_ACCOUNTS.includes(receiver)) return 'burn';
  return null;
}

export function isProposalFunded(
  paidProposalIds: number[],
  proposalId: number,
  startIso: string,
  endIso: string
): boolean {
  const now = Date.now();
  const start = proposalDateMs(startIso);
  const end = proposalDateMs(endIso);
  return start <= now && paidProposalIds.includes(proposalId) && end > now;
}

export function votesToSp(
  totalVotes: number,
  totalVestingShares: string,
  totalVestingFundSteem: string
): number {
  const totalVests = parseSteemAsset(totalVestingShares);
  const totalFund = parseSteemAsset(totalVestingFundSteem);
  if (totalVests <= 0 || totalFund <= 0) return 0;
  return totalFund * (totalVotes / totalVests) * 0.000001;
}

export function computePaidProposalIds(
  activeProposals: Proposal[],
  dailyBudgetSbd: number
): number[] {
  let budget = dailyBudgetSbd;
  const ids: number[] = [];
  for (const proposal of activeProposals) {
    const pay = parseSteemAsset(proposal.daily_pay);
    if (pay <= 0) continue;
    if (budget - pay >= 0) {
      budget -= pay;
      ids.push(proposal.proposal_id);
    } else if (budget > 0 && budget - pay < 0) {
      budget -= pay;
      ids.push(proposal.proposal_id);
      break;
    } else {
      break;
    }
  }
  return ids;
}

export function filterProposalsBySearch(proposals: Proposal[], searchTerm: string): Proposal[] {
  const q = searchTerm.trim().toLowerCase();
  if (!q) return proposals;
  return proposals.filter((p) => {
    return (
      p.subject?.toLowerCase().includes(q) ||
      p.receiver?.toLowerCase().includes(q) ||
      p.permlink?.toLowerCase().includes(q) ||
      p.creator?.toLowerCase().includes(q)
    );
  });
}
