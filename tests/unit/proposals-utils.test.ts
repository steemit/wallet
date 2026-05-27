import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/lib/steem/types';
import {
  abbreviateNumber,
  computePaidProposalIds,
  filterProposalsBySearch,
  isProposalFunded,
  numberWithCommas,
  proposalFundingType,
  proposalLifecycle,
  votesToSp,
} from '@/lib/proposals/utils';

describe('proposals utils', () => {
  it('formats numbers with commas', () => {
    expect(numberWithCommas(0)).toBe('0');
    expect(numberWithCommas('1234.567')).toBe('1,234.567');
    expect(numberWithCommas(2780859.859)).toBe('2,780,859.859');
  });

  it('abbreviates numbers', () => {
    expect(abbreviateNumber(12.3456)).toBe('12.35');
    expect(abbreviateNumber(1234.56)).toBe('1.23K');
    expect(abbreviateNumber(1_234_567.89)).toBe('1.23M');
  });

  it('computes proposal lifecycle', () => {
    const now = Date.now();
    const past = new Date(now - 60_000).toISOString();
    const future = new Date(now + 60_000).toISOString();
    expect(proposalLifecycle(past, future)).toBe('started');
    expect(proposalLifecycle(future, new Date(now + 120_000).toISOString())).toBe('not_started');
    expect(proposalLifecycle(past, past)).toBe('finished');
  });

  it('detects funding type', () => {
    expect(proposalFundingType('steem.dao')).toBe('refund');
    expect(proposalFundingType('null')).toBe('burn');
    expect(proposalFundingType('alice')).toBe(null);
  });

  it('detects funded proposals based on paid ids and timing', () => {
    const now = Date.now();
    const start = new Date(now - 60_000).toISOString();
    const end = new Date(now + 60_000).toISOString();
    expect(isProposalFunded([10], 10, start, end)).toBe(true);
    expect(isProposalFunded([10], 11, start, end)).toBe(false);
    expect(isProposalFunded([10], 10, new Date(now + 60_000).toISOString(), end)).toBe(false);
    expect(isProposalFunded([10], 10, start, new Date(now - 1).toISOString())).toBe(false);
  });

  it('filters proposals by search term', () => {
    const proposals = [
      { subject: 'Hello World', receiver: 'bob', permlink: 'p1', creator: 'alice' },
      { subject: 'Another', receiver: 'charlie', permlink: 'wow', creator: 'dan' },
    ] as unknown as Proposal[];
    expect(filterProposalsBySearch(proposals, '')).toHaveLength(2);
    expect(filterProposalsBySearch(proposals, 'hello')).toHaveLength(1);
    expect(filterProposalsBySearch(proposals, 'BOB')).toHaveLength(1);
    expect(filterProposalsBySearch(proposals, 'wow')).toHaveLength(1);
    expect(filterProposalsBySearch(proposals, 'dan')).toHaveLength(1);
    expect(filterProposalsBySearch(proposals, 'missing')).toHaveLength(0);
  });

  it('computes paid proposal ids from daily budget', () => {
    const active = [
      { proposal_id: 1, daily_pay: '5.000 SBD' },
      { proposal_id: 2, daily_pay: { amount: '6000', precision: 3, nai: '@@000000013' } }, // 6.000
      { proposal_id: 3, daily_pay: '100.000 SBD' },
    ] as unknown as Proposal[];

    expect(computePaidProposalIds(active, 11)).toEqual([1, 2]);
    // Legacy behavior: include the first partially-funded proposal and stop.
    expect(computePaidProposalIds(active, 4)).toEqual([1]);
    expect(computePaidProposalIds(active, 5)).toEqual([1]);
    expect(computePaidProposalIds(active, 5.1)).toEqual([1, 2]);
  });

  it('converts votes to SP deterministically', () => {
    // Simple sanity: if total_votes == total_vesting_shares, SP equals total fund * 0.000001
    const sp = votesToSp(100, '100.000000 VESTS', '10.000 STEEM');
    expect(sp).toBeCloseTo(0.00001, 12);
  });
});

