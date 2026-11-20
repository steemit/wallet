/**
 * DelegationsSection — revoke flow and table behaviour.
 *
 * Since A6-T3a the revoke flow signs through the unified session signing
 * entry (`useSessionSigning`, mocked here at its module boundary): privateKey
 * sessions sign through the facade's legacy backend, vault identity sessions
 * through the per-key password dialog. The tests pin the byte-identical
 * zero-VESTS operation tuple and each outcome's handling; the signing error
 * contract is unchanged — the raw library error stays in the console and the
 * localized copy renders (the same contract delegate-form follows), while
 * relay failures surface the chain's own answer verbatim.
 *
 * The rest of the file covers the table around that dialog (sorting, search,
 * pagination, the two tabs, load/empty/error states) so the component is
 * exercised as a whole rather than only through the revoke path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DelegationsSection } from '@/components/wallet/delegations-section';
import { apiClient } from '@/lib/steem/client';
import type { VestingDelegation, ExpiringVestingDelegation } from '@/lib/steem/types';

// The section reads its data from two hooks; the holders below let each test
// decide what those hooks report.
const hooks = vi.hoisted(() => ({
  refetch: vi.fn(),
  outgoing: {
    delegations: [] as VestingDelegation[],
    loading: false,
    error: null as string | null,
  },
  expiring: {
    delegations: [] as ExpiringVestingDelegation[],
    loading: false,
    error: null as string | null,
  },
}));

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/hooks/use-delegations', () => ({
  useVestingDelegations: () => ({
    delegations: hooks.outgoing.delegations,
    loading: hooks.outgoing.loading,
    error: hooks.outgoing.error,
    refetch: hooks.refetch,
  }),
  useExpiringVestingDelegations: () => ({
    delegations: hooks.expiring.delegations,
    loading: hooks.expiring.loading,
    error: hooks.expiring.error,
  }),
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: { broadcastDelegate: vi.fn() },
}));

const broadcastDelegate = vi.mocked(apiClient.broadcastDelegate);

function delegation(
  delegatee: string,
  over: Partial<VestingDelegation> = {}
): VestingDelegation {
  return {
    delegator: 'alice',
    delegatee,
    vesting_shares: '100.000000 VESTS',
    min_delegation_time: '2026-01-01T00:00:00',
    ...over,
  };
}

function expiringDelegation(id: number): ExpiringVestingDelegation {
  return {
    id,
    delegator: 'alice',
    vesting_shares: '50.000000 VESTS',
    expiration: '2026-03-01T00:00:00',
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  hooks.outgoing = { delegations: [delegation('bob')], loading: false, error: null };
  hooks.expiring = { delegations: [], loading: false, error: null };
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

function renderSection() {
  return render(
    <DelegationsSection
      username="alice"
      globalProps={null}
      globalPropsLoading={false}
      isMyAccount
    />
  );
}

/** Names of the delegation rows, in the order the desktop table renders them. */
function rowOrder(): string[] {
  return screen
    .getAllByRole('link')
    .map((el) => el.textContent ?? '')
    .filter((_, index, all) => index < all.length / 2); // desktop table comes first
}

function openRevokeDialog() {
  fireEvent.click(screen.getAllByText('revoke')[0]!);
  return screen.getByRole('alertdialog');
}

function confirmRevoke(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'revoke' }));
}

describe('DelegationsSection revoke dialog', () => {
  it('consoles the raw error and shows the localized message when broadcast throws', async () => {
    const raw = new Error(
      'Operation type delegate_vesting_shares serialization not fully implemented'
    );
    mocks.sign.mockResolvedValueOnce({
      status: 'signed',
      result: { signedTx: { signatures: ['SIG'], operations: [] } },
    });
    broadcastDelegate.mockRejectedValueOnce(raw);

    renderSection();
    confirmRevoke(openRevokeDialog());

    await waitFor(() => {
      expect(screen.getByText('revokeFailed')).toBeTruthy();
    });
    expect(consoleError).toHaveBeenCalledWith('Revoke delegation error:', raw);
    // The library internal must never reach the user.
    expect(screen.queryByText(/serialization not fully implemented/)).toBeNull();
  });

  it('still surfaces the relay/chain error from an unsuccessful broadcast', async () => {
    mocks.sign.mockResolvedValueOnce({
      status: 'signed',
      result: { signedTx: { signatures: ['SIG'], operations: [] } },
    });
    broadcastDelegate.mockResolvedValueOnce({
      success: false,
      error: 'missing required active authority',
    });

    renderSection();
    confirmRevoke(openRevokeDialog());

    await waitFor(() => {
      expect(screen.getByText('missing required active authority')).toBeTruthy();
    });
    // A relay rejection is an answer, not an internal — nothing to console.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('signs the byte-identical zero-VESTS revoke tuple and refreshes on success', async () => {
    mocks.sign.mockResolvedValueOnce({
      status: 'signed',
      result: { signedTx: { signatures: ['SIG'], operations: [] } },
    });
    broadcastDelegate.mockResolvedValueOnce({ success: true });

    renderSection();
    confirmRevoke(openRevokeDialog());

    await waitFor(() => {
      expect(hooks.refetch).toHaveBeenCalledTimes(1);
    });
    // Byte-identical to what SteemSigner.signDelegate built before A6-T3a.
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        [
          'delegate_vesting_shares',
          { delegator: 'alice', delegatee: 'bob', vesting_shares: '0.000000 VESTS' },
        ],
      ],
      accountName: 'alice',
      role: 'active',
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a user cancel in the signing dialog is a quiet no-op (dialog stays, no error)', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });

    renderSection();
    const dialog = openRevokeDialog();
    confirmRevoke(dialog);

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastDelegate).not.toHaveBeenCalled();
    // No error copy; the confirmation dialog remains usable.
    expect(screen.queryByText('revokeFailed')).toBeNull();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('needsClassicReauth is the same quiet no-op a keyless session always had', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });

    renderSection();
    confirmRevoke(openRevokeDialog());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastDelegate).not.toHaveBeenCalled();
    expect(screen.queryByText('revokeFailed')).toBeNull();
  });

  it('a typed signing error shows the localized copy', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'error', code: 'unexpected' });

    renderSection();
    confirmRevoke(openRevokeDialog());

    await waitFor(() => {
      expect(screen.getByText('revokeFailed')).toBeTruthy();
    });
    expect(broadcastDelegate).not.toHaveBeenCalled();
  });
});

describe('DelegationsSection table', () => {
  it('sorts by delegatee, date and amount when a column header is clicked', () => {
    hooks.outgoing.delegations = [
      delegation('carol', {
        vesting_shares: '10.000000 VESTS',
        min_delegation_time: '2026-02-01T00:00:00',
      }),
      delegation('bob', {
        vesting_shares: '300.000000 VESTS',
        min_delegation_time: '2026-03-01T00:00:00',
      }),
      delegation('ann', {
        vesting_shares: '20.000000 VESTS',
        min_delegation_time: '2026-01-01T00:00:00',
      }),
    ];
    renderSection();

    // Default order: delegatee ascending.
    expect(rowOrder()).toEqual(['ann', 'bob', 'carol']);

    fireEvent.click(screen.getByRole('button', { name: 'delegatee' }));
    expect(rowOrder()).toEqual(['carol', 'bob', 'ann']); // same column toggles to desc

    fireEvent.click(screen.getByRole('button', { name: 'startDate' }));
    expect(rowOrder()).toEqual(['ann', 'carol', 'bob']);

    fireEvent.click(screen.getByRole('button', { name: 'amountDelegated' }));
    expect(rowOrder()).toEqual(['carol', 'ann', 'bob']);
  });

  it('filters by delegatee through the search box', () => {
    hooks.outgoing.delegations = [
      delegation('bob'),
      delegation('carol'),
      delegation('bobby'),
    ];
    renderSection();

    expect(screen.getByText('delegationCount')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('searchDelegations'), {
      target: { value: 'bob' },
    });

    expect(rowOrder()).toEqual(['bob', 'bobby']);
  });

  it('pages through more delegations than fit on one page', () => {
    hooks.outgoing.delegations = Array.from({ length: 21 }, (_, i) =>
      delegation(`user${String(i).padStart(2, '0')}`)
    );
    renderSection();

    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(rowOrder()).toHaveLength(20);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]!); // pager "next"

    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(rowOrder()).toEqual(['user20']);
  });

  it('switches to the expiring delegations tab, sorts and renders its rows', () => {
    hooks.expiring = {
      delegations: [expiringDelegation(1), expiringDelegation(2)],
      loading: false,
      error: null,
    };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'expiringDelegations' }));

    // The expiring table lists completion time + returned amount (no delegatee).
    expect(screen.getAllByTitle('2026-03-01T00:00:00').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('50 VESTS').length).toBeGreaterThan(0);

    // ...and has its own sortable headers.
    fireEvent.click(screen.getByRole('button', { name: 'expirationTime' }));
    fireEvent.click(screen.getByRole('button', { name: 'amountReturned' }));
    expect(screen.getAllByTitle('2026-03-01T00:00:00').length).toBeGreaterThan(0);
  });

  it('renders the expiring tab even if a row arrives as a NAI asset object', () => {
    // Regression (MAIN-62): before the server normalized database_api's NAI
    // assets, vesting_shares reached this component as an object and
    // parseAssetAmount threw mid-render, blanking the whole page. Cached
    // responses could still carry the old shape past the deploy.
    hooks.expiring = {
      delegations: [
        {
          ...expiringDelegation(3),
          vesting_shares: { amount: '5971304284', nai: '@@000000037', precision: 6 } as never,
        },
      ],
      loading: false,
      error: null,
    };
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'expiringDelegations' }));

    expect(screen.getAllByTitle('2026-03-01T00:00:00').length).toBeGreaterThan(0);
    // The row normalizes to a string and renders rather than throwing.
    expect(screen.getAllByText('5971.304284 VESTS').length).toBeGreaterThan(0);
  });

  it('reports an empty expiring list when the tab has nothing to show', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'expiringDelegations' }));

    expect(screen.getByText('noExpiringDelegations')).toBeTruthy();
  });

  it('reports an empty outgoing list instead of an empty table', () => {
    hooks.outgoing.delegations = [];
    renderSection();

    expect(screen.getByText('noOutgoingDelegations')).toBeTruthy();
    expect(screen.queryByText('revoke')).toBeNull();
  });

  it('shows the placeholder while the active list is loading', () => {
    hooks.outgoing.loading = true;
    renderSection();

    expect(screen.queryByText('revoke')).toBeNull();
    expect(screen.queryByText('noOutgoingDelegations')).toBeNull();
  });

  it('surfaces a fetch error above the list', () => {
    hooks.outgoing.error = 'query failed';
    renderSection();

    expect(screen.getByText('query failed')).toBeTruthy();
  });

  it('does not offer revoke buttons on someone else’s delegations', () => {
    render(
      <DelegationsSection
        username="alice"
        globalProps={null}
        globalPropsLoading={false}
        isMyAccount={false}
      />
    );

    expect(screen.queryByText('revoke')).toBeNull();
  });

  it('copies a delegation start time to the clipboard on click', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    renderSection();
    fireEvent.click(screen.getByTitle('2026-01-01T00:00:00'));

    expect(writeText).toHaveBeenCalledWith('2026-01-01T00:00:00');
    vi.unstubAllGlobals();
  });
});
