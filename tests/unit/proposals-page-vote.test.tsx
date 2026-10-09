/**
 * Proposals page — optimistic vote flow (finding K-3).
 *
 * The proposals route serves username'd responses with `private, max-age=15`;
 * after voting, the plain-fetched refresh could re-serve the pre-vote
 * upVoted for up to 15s, inviting repeat clicks. The page now flips the
 * voted state locally the moment the user clicks, and rolls it back when the
 * broadcast fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProposalsPageClient } from '@/components/proposals-page-client';

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(),
  refreshMeta: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ username: 'alice', isAuthenticated: true }),
  useActiveSigningKey: () => '5Jactivekey',
}));

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signUpdateProposalVotes: vi.fn().mockResolvedValue({ signed: 'tx' }),
  },
  apiClient: {
    broadcastProposalVote: mocks.broadcast,
    getGlobalProps: vi.fn().mockResolvedValue({ props: { total_vesting_shares: '1 VESTS' } }),
  },
}));

vi.mock('@/hooks/use-proposals-meta', () => ({
  useProposalsMeta: () => ({
    daoTreasury: null,
    dailyBudget: null,
    paidProposalIds: [],
    treasuryFeeSbd: null,
    loading: false,
    refreshMeta: mocks.refreshMeta,
  }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => null,
}));
vi.mock('@/components/proposals/proposal-creator-dialog', () => ({
  ProposalCreatorDialog: () => null,
}));
vi.mock('@/components/proposals/proposal-remove-dialog', () => ({
  ProposalRemoveDialog: () => null,
}));
vi.mock('@/components/proposals/proposal-voters-dialog', () => ({
  ProposalVotersDialog: () => null,
}));

const PROPOSAL = {
  id: 1,
  proposal_id: 1,
  creator: 'creator',
  receiver: 'receiver',
  start_date: '2026-01-01T00:00:00',
  end_date: '2027-01-01T00:00:00',
  daily_pay: '10.000 SBD',
  subject: 'Test proposal',
  permlink: 'permlink',
  total_votes: 0,
  upVoted: false,
};

function okJson(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockFetch = vi.fn();

// next-intl is mocked to echo the bare message key, so the vote button's
// accessible name is exactly 'vote' / 'unvote'.
function voteButton() {
  return screen.getByRole('button', { name: 'vote' });
}

function unvoteButton() {
  return screen.getByRole('button', { name: 'unvote' });
}

describe('ProposalsPageClient — optimistic vote (K-3)', () => {
  // Server truth: flips to voted once the vote broadcast succeeded.
  let serverUpVoted = false;

  beforeEach(() => {
    vi.clearAllMocks();
    serverUpVoted = false;
    mockFetch.mockReset();
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/query/proposals')) {
        return Promise.resolve(
          okJson({ success: true, proposals: [{ ...PROPOSAL, upVoted: serverUpVoted }] })
        );
      }
      return Promise.resolve(okJson({ success: true }));
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  it('flips the voted state immediately on click while the broadcast is pending', async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    mocks.broadcast.mockReturnValueOnce(pending.promise);

    render(<ProposalsPageClient />);

    await waitFor(() => expect(voteButton()).toBeInTheDocument());
    expect(voteButton().textContent).toContain('vote');

    fireEvent.click(voteButton());

    // Optimistic flip happens before the broadcast resolves.
    expect(unvoteButton()).toBeInTheDocument();

    // Success: the chain (mocked server) confirms the vote; stays flipped.
    serverUpVoted = true;
    await act(async () => {
      pending.resolve({ success: true });
    });
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/query/proposals'),
        { cache: 'no-store' }
      )
    );
    expect(unvoteButton()).toBeInTheDocument();
  });

  it('rolls the voted state back when the broadcast fails', async () => {
    const pending = deferred<{ success: boolean; error?: string }>();
    mocks.broadcast.mockReturnValueOnce(pending.promise);

    render(<ProposalsPageClient />);
    await waitFor(() => expect(voteButton()).toBeInTheDocument());

    fireEvent.click(voteButton());
    expect(unvoteButton()).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ success: false, error: 'rejected' });
    });

    await waitFor(() => expect(voteButton()).toBeInTheDocument());
    expect(voteButton().textContent).toContain('vote');
  });

  it('rolls the voted state back when signing/broadcast throws', async () => {
    mocks.broadcast.mockRejectedValueOnce(new Error('network down'));

    render(<ProposalsPageClient />);
    await waitFor(() => expect(voteButton()).toBeInTheDocument());

    fireEvent.click(voteButton());
    expect(unvoteButton()).toBeInTheDocument();

    await waitFor(() => {
      expect(voteButton().textContent).toContain('vote');
    });
  });
});
