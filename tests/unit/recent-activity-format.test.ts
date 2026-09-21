/**
 * formatTransferRow context-comparison regression tests (review finding C-1).
 *
 * The page context username arrives from the visitor's URL (e.g. /@Alice)
 * while chain op fields are canonical lowercase. Raw `===` made incoming
 * payments render as outgoing transfers, reversed buy/sell order direction,
 * and wrong delegation direction whenever the URL case differed from the
 * session/chain spelling. All direction checks must compare normalized.
 */
import { describe, it, expect } from 'vitest';
import { formatTransferRow } from '@/components/wallet/recent-activity';
import type { SteemHistoryItem } from '@/lib/wallet/normalize-history';

function item(op: [string, Record<string, unknown>]): SteemHistoryItem {
  return {
    op,
    timestamp: '2026-09-01T10:00:00',
    block: 1000000,
    trx_id: 'trx-1',
    index: 1,
  };
}

describe('formatTransferRow — normalized context comparisons', () => {
  it('renders an incoming transfer as Received when the URL case differs from chain data', () => {
    // Session/url context "Alice", chain field "alice": still MY incoming payment.
    const row = formatTransferRow(
      item(['transfer', { from: 'bob', to: 'alice', amount: '1.000 SBD', memo: '' }]),
      'Alice'
    );
    expect(row.description).toBe('Received 1.000 SBD from bob');
  });

  it('renders an outgoing transfer when the recipient is someone else (mixed-case context)', () => {
    const row = formatTransferRow(
      item(['transfer', { from: 'alice', to: 'bob', amount: '1.000 SBD', memo: '' }]),
      '@Alice '
    );
    expect(row.description).toBe('Transferred 1.000 SBD to bob');
  });

  it('keeps fill_order direction stable across casings of the same account', () => {
    const fillOrder = () =>
      item([
        'fill_order',
        {
          current_owner: 'alice',
          current_pays: '1.000 SBD',
          open_owner: 'bob',
          open_pays: '10.000 STEEM',
        },
      ]);

    // From alice's page (URL case "Alice"): she is NOT the open-order owner,
    // so she paid her current_pays for the open order's open_pays.
    const asAlice = formatTransferRow(fillOrder(), 'Alice');
    expect(asAlice.description).toBe('Paid 1.000 SBD for 10.000 STEEM');

    // From bob's page ("Bob"): he owns the open order, so he paid open_pays
    // for current_pays — direction flips with the account, not the casing.
    const asBob = formatTransferRow(fillOrder(), 'Bob');
    expect(asBob.description).toBe('Paid 10.000 STEEM for 1.000 SBD');

    // Lowercase spelling of the same page must not change the rendering.
    expect(formatTransferRow(fillOrder(), 'alice').description).toBe(asAlice.description);
  });

  it('renders outgoing vs incoming delegation by normalized delegator match', () => {
    const delegated = formatTransferRow(
      item(['delegate_vesting_shares', { delegator: 'alice', delegatee: 'bob', vesting_shares: '1.000000 VESTS' }]),
      'Alice'
    );
    expect(delegated.description).toContain('Delegated');

    const received = formatTransferRow(
      item(['delegate_vesting_shares', { delegator: 'bob', delegatee: 'alice', vesting_shares: '1.000000 VESTS' }]),
      '@Alice'
    );
    expect(received.description).toContain('Received delegation');
  });
});
