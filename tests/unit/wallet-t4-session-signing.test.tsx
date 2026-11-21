/**
 * The five A6-T4 callers × useSessionSigning integration — market
 * (limit_order_create / limit_order_cancel), proposals vote
 * (update_proposal_votes), proposal create (create_proposal), proposal
 * remove (remove_proposal) and witness voting (account_witness_vote /
 * account_witness_proxy) — in all three session shapes. The hook is mocked
 * at its module boundary (its own matrix lives in
 * use-session-signing.test.tsx); these tests pin what each CALLER does with
 * each outcome:
 *   - privateKey session: the action is NOT key-gated up front, the
 *     byte-identical operation tuple (exactly what the retired
 *     SteemSigner.* builder built, including field order and the
 * limit_order_create ISO expiration conversion) reaches the unified entry
 * at the ACTIVE floor, and the broadcast follows on `signed`;
 *   - vault identity session (no Redux keys): the action is AVAILABLE and
 *     completes through the unified entry — NO login dialog is ever opened
 *     for an authenticated vault session (the pre-A6 re-login loop /
 *     vaultUnsupported notice reachability is retired);
 *   - privateKey session missing an active/owner key: `needsClassicReauth`
 *     routes to the caller's classic re-auth dialog (fixedUsername locked
 *     to the session account + requiredAuthTypes ['active']).
 *
 * Login-dialog contract pins (the documented pre-A6 gap closure): the
 * market / proposals / witnesses sign-in dialogs pass requiredAuthTypes
 * ['active'] with NO fixedUsername (session-account pages: unauthenticated
 * visitors may log in as any account; a privateKey login is fit for
 * purpose the first time because every action on these pages is
 * active-class).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { MarketPageClient } from '@/components/market/market-page-client';
import { ProposalsPageClient } from '@/components/proposals-page-client';
import { ProposalCreatorDialog } from '@/components/proposals/proposal-creator-dialog';
import { ProposalRemoveDialog } from '@/components/proposals/proposal-remove-dialog';
import { WitnessVoteForm } from '@/components/wallet/witness-vote-form';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// STABLE echo function: witness-vote-form's mount effect lists the returned
// translator in its deps — a fresh identity per render would loop it.
vi.mock('next-intl', () => {
  const echo = (key: string) => key;
  return { useTranslations: () => echo };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  /** Every props object the embedded LoginForm probe received. */
  loginFormCalls: [] as Array<{
    fixedUsername?: string | undefined;
    requiredAuthTypes?: string[] | undefined;
  }>,
  broadcastLimitOrderCreate: vi.fn().mockResolvedValue({ success: true }),
  broadcastLimitOrderCancel: vi.fn().mockResolvedValue({ success: true }),
  broadcastProposalVote: vi.fn().mockResolvedValue({ success: true }),
  broadcastProposalCreate: vi.fn().mockResolvedValue({ success: true }),
  broadcastProposalRemove: vi.fn().mockResolvedValue({ success: true }),
  broadcastWitnessVote: vi.fn().mockResolvedValue({ success: true }),
  broadcastWitnessProxy: vi.fn().mockResolvedValue({ success: true }),
  getWitnesses: vi.fn(),
  getGlobalProps: vi.fn(),
  refetchAccount: vi.fn().mockResolvedValue(undefined),
  refreshMarket: vi.fn().mockResolvedValue(undefined),
  refreshMeta: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn(),
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/components/auth/login-form', () => ({
  // Probe: records the props each embedded dialog passes (the propagation
  // pins) and renders a marker so dialog-open assertions work.
  LoginForm: (props: { fixedUsername?: string; requiredAuthTypes?: string[] }) => {
    mocks.loginFormCalls.push({
      fixedUsername: props.fixedUsername,
      requiredAuthTypes: props.requiredAuthTypes,
    });
    return <div data-testid="login-form-probe" />;
  },
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    broadcastLimitOrderCreate: (...args: unknown[]) => mocks.broadcastLimitOrderCreate(...args),
    broadcastLimitOrderCancel: (...args: unknown[]) => mocks.broadcastLimitOrderCancel(...args),
    broadcastProposalVote: (...args: unknown[]) => mocks.broadcastProposalVote(...args),
    broadcastProposalCreate: (...args: unknown[]) => mocks.broadcastProposalCreate(...args),
    broadcastProposalRemove: (...args: unknown[]) => mocks.broadcastProposalRemove(...args),
    broadcastWitnessVote: (...args: unknown[]) => mocks.broadcastWitnessVote(...args),
    broadcastWitnessProxy: (...args: unknown[]) => mocks.broadcastWitnessProxy(...args),
    getWitnesses: (...args: unknown[]) => mocks.getWitnesses(...args),
    getGlobalProps: (...args: unknown[]) => mocks.getGlobalProps(...args),
  },
}));

vi.mock('@/hooks/use-market-data', () => ({
  useMarketData: () => ({
    orderbook: { bids: [], asks: [] },
    ticker: {
      latest: 1,
      lowest_ask: 1,
      highest_bid: 1,
      percent_change: 0,
      steem_volume: 0,
      sbd_volume: 0,
    },
    history: [],
    openOrders: [
      { orderid: 42, created: '2026-01-01T00:00:00', type: 'bid', steem: 1, sbd: 1, price: 1 },
    ],
    loading: false,
    error: null,
    refresh: mocks.refreshMarket,
  }),
}));

vi.mock('@/hooks/use-steem-account', () => ({
  useSteemAccount: () => ({
    data: { balance: '100.000 STEEM', sbd_balance: '100.000 SBD' },
  }),
}));

vi.mock('@/lib/cache/client-invalidate', () => ({
  invalidateWalletCache: mocks.invalidate,
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

vi.mock('@/components/proposals/proposal-voters-dialog', () => ({
  ProposalVotersDialog: () => null,
}));

vi.mock('@/hooks/use-account-data', () => ({
  useAccountData: () => ({
    data: { name: 'alice', proxy: '', witness_votes: [] as string[] },
    refetch: mocks.refetchAccount,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: vi.fn(),
}));

import { userActionRecord } from '@/lib/analytics/overseer';

const BASE_AUTH: AuthState = {
  username: null,
  ownerKey: null,
  activeKey: null,
  postingKey: null,
  memoKey: null,
  privateKey: null,
  publicKey: null,
  isAuthenticated: false,
  sessionKind: 'privateKey',
};

type TestStore = ReturnType<typeof privateKeyStore>;

function privateKeyStore(username: string, withActiveKey: boolean) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        ...BASE_AUTH,
        username,
        // A posting-only privateKey session: enough to be "logged in", no
        // key at-or-above the active floor.
        postingKey: '5J-test-posting-key',
        activeKey: withActiveKey ? '5J-test-active-key' : null,
        privateKey: withActiveKey ? '5J-test-active-key' : '5J-test-posting-key',
        isAuthenticated: true,
      } satisfies AuthState,
    },
  });
}

function vaultStore(username = 'alice') {
  const store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: BASE_AUTH } });
  store.dispatch(setVaultIdentity({ username }));
  return store;
}

function signedOutcome() {
  return {
    status: 'signed' as const,
    result: { signedTx: { signatures: ['SIG'], operations: [] } },
  };
}

/** The i-th signing request's single operation tuple. */
function signedOperation(callIndex = 0): [string, Record<string, unknown>] {
  const request = mocks.sign.mock.calls[callIndex]?.[0] as {
    operations: Array<[string, Record<string, unknown>]>;
  };
  const op = request?.operations?.[0];
  if (!op) throw new Error('expected one signing request with an operation tuple');
  return op;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The hook mock cannot see the store: session-shape routing is the REAL
  // hook's own matrix; here each caller test pins its reaction to the
  // outcome, so the keyless tests inject the outcome explicitly.
  mocks.sign.mockResolvedValue(signedOutcome());
  mocks.loginFormCalls.length = 0;
  mocks.getWitnesses.mockResolvedValue({
    witnesses: [
      {
        owner: 'witness1',
        votes: '1000',
        total_missed: 0,
        running_version: '0.23.0',
        signing_key: 'STM8ActiveAuthorityKeyNotInFixtures000000000000',
        last_confirmed_block_num: 100,
      },
    ],
  });
  mocks.getGlobalProps.mockResolvedValue({
    props: {
      head_block_number: 100,
      total_vesting_shares: '1 VESTS',
      total_vesting_fund_steem: '1 STEEM',
    },
  });
});

/* ───────── MarketPageClient ───────── */

function renderMarket(store: TestStore) {
  return render(
    <Provider store={store}>
      <MarketPageClient />
    </Provider>
  );
}

/** Fill the buy form (price auto-seeds 1 from the ticker) and submit. */
async function placeBuyOrder() {
  fireEvent.change(screen.getAllByLabelText('amount')[0]!, { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'buySteem' }));
}

async function cancelOpenOrder() {
  fireEvent.click(screen.getByRole('button', { name: 'cancelOrder' }));
}

describe('MarketPageClient × session signing (A6-T4)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('privateKey with key: byte-identical limit_order_create tuple at the active floor', async () => {
    renderMarket(privateKeyStore('alice', true));
    await placeBuyOrder();

    await waitFor(() => expect(mocks.broadcastLimitOrderCreate).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    const [type, payload] = signedOperation();
    // Exactly what SteemSigner.signLimitOrderCreate built: field order,
    // fill_or_kill default, ISO expiration (not unix seconds).
    expect(type).toBe('limit_order_create');
    expect(payload).toEqual({
      owner: 'alice',
      amount_to_sell: '5.000 SBD',
      min_to_receive: '5.000 STEEM',
      fill_or_kill: false,
      expiration: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
      orderid: expect.any(Number),
    });
    // Object key order pinned byte-for-byte (serialization order matters).
    expect(Object.keys(payload)).toEqual([
      'owner',
      'amount_to_sell',
      'min_to_receive',
      'fill_or_kill',
      'expiration',
      'orderid',
    ]);
    const orderid = payload.orderid as number;
    expect(orderid).toBeGreaterThanOrEqual(0);
    expect(orderid).toBeLessThanOrEqual(4_294_967_295);
    expect(mocks.broadcastLimitOrderCreate).toHaveBeenCalledWith(
      signedOutcome().result.signedTx,
      'alice'
    );
  });

  it('vault identity session trades without any Redux key and NO login dialog', async () => {
    renderMarket(vaultStore());
    await placeBuyOrder();

    await waitFor(() => expect(mocks.broadcastLimitOrderCreate).toHaveBeenCalledTimes(1));
    // The pre-A6 gap: an authenticated vault session reopened the login
    // dialog (identity selection loop). Now no LoginForm is ever rendered.
    expect(mocks.loginFormCalls).toHaveLength(0);
  });

  it('keyless privateKey: needsClassicReauth opens the account-locked re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    renderMarket(privateKeyStore('alice', false));
    await placeBuyOrder();

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastLimitOrderCreate).not.toHaveBeenCalled();
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: 'alice',
      requiredAuthTypes: ['active'],
    });
  });

  it('cancel: byte-identical limit_order_cancel tuple; vault session completes', async () => {
    renderMarket(vaultStore());
    await cancelOpenOrder();

    await waitFor(() => expect(mocks.broadcastLimitOrderCancel).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'limit_order_cancel',
      { owner: 'alice', orderid: 42 },
    ]);
    expect(mocks.loginFormCalls).toHaveLength(0);
  });

  it('anonymous visitor: the sign-in dialog asks for the active authority, no fixed username', async () => {
    const anonStore = configureStore({
      reducer: { auth: authReducer },
      preloadedState: { auth: BASE_AUTH },
    });
    renderMarket(anonStore);

    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: undefined,
      requiredAuthTypes: ['active'],
    });
  });
});

/* ───────── ProposalsPageClient (update_proposal_votes) ───────── */

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

const mockFetch = vi.fn();

function renderProposals(store: TestStore) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/query/proposals')) {
      return Promise.resolve(okJson({ success: true, proposals: [{ ...PROPOSAL }] }));
    }
    return Promise.resolve(okJson({ success: true }));
  });
  vi.stubGlobal('fetch', mockFetch);
  return render(
    <Provider store={store}>
      <ProposalsPageClient />
    </Provider>
  );
}

async function voteOnProposal() {
  fireEvent.click(await screen.findByRole('button', { name: 'vote' }));
}

describe('ProposalsPageClient × session signing (A6-T4)', () => {
  it('privateKey with key: byte-identical update_proposal_votes tuple at the ACTIVE floor', async () => {
    renderProposals(privateKeyStore('alice', true));
    await voteOnProposal();

    await waitFor(() => expect(mocks.broadcastProposalVote).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    // update_proposal_votes is an ACTIVE-class Steem operation (the legacy
    // postingOps whitelist never listed it; the previous caller signed it
    // with the active-or-owner key) — the floor preserves that resolution.
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'update_proposal_votes',
      { voter: 'alice', proposal_ids: [1], approve: true },
    ]);
  });

  it('vault identity session votes without any Redux key and NO login dialog', async () => {
    renderProposals(vaultStore());
    await voteOnProposal();

    await waitFor(() => expect(mocks.broadcastProposalVote).toHaveBeenCalledTimes(1));
    expect(mocks.loginFormCalls).toHaveLength(0);
  });

  it('keyless privateKey: needsClassicReauth rolls the optimistic vote back and opens re-auth', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    renderProposals(privateKeyStore('alice', false));
    await voteOnProposal();

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.broadcastProposalVote).not.toHaveBeenCalled();
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: 'alice',
      requiredAuthTypes: ['active'],
    });
    // Optimistic flip rolled back — the button still offers "vote". (The
    // open re-auth dialog aria-hides the page tree, so query with hidden.)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'vote', hidden: true })).toBeInTheDocument()
    );
  });

  it('anonymous visitor: the sign-in dialog asks for the active authority, no fixed username', async () => {
    const anonStore = configureStore({
      reducer: { auth: authReducer },
      preloadedState: { auth: BASE_AUTH },
    });
    renderProposals(anonStore);

    fireEvent.click(await screen.findByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: undefined,
      requiredAuthTypes: ['active'],
    });
  });
});

/* ───────── ProposalCreatorDialog (create_proposal) ───────── */

function renderCreator(store: TestStore) {
  const onSuccess = vi.fn();
  render(
    <Provider store={store}>
      <ProposalCreatorDialog
        open
        onOpenChange={vi.fn()}
        username="alice"
        treasuryFeeSbd="10.000"
        onSuccess={onSuccess}
        onNeedLogin={vi.fn()}
      />
    </Provider>
  );
  return { onSuccess };
}

function fillCreatorForm() {
  fireEvent.change(screen.getByLabelText('createTitle'), { target: { value: 'Dev fund' } });
  fireEvent.change(screen.getByLabelText('createDailyAmount'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('createStartDate'), {
    target: { value: '2026-10-01T00:00' },
  });
  fireEvent.change(screen.getByLabelText('createEndDate'), {
    target: { value: '2026-10-15T00:00' },
  });
  fireEvent.change(screen.getByLabelText('createPermlink'), { target: { value: 'dev-fund-post' } });
  fireEvent.change(screen.getByLabelText('createCreator'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('createReceiver'), { target: { value: '@Alice' } });
}

describe('ProposalCreatorDialog × session signing (A6-T4)', () => {
  it('privateKey with key: byte-identical create_proposal tuple at the active floor', async () => {
    const { onSuccess } = renderCreator(privateKeyStore('alice', true));
    fillCreatorForm();
    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.broadcastProposalCreate).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'create_proposal',
      {
        creator: 'alice',
        receiver: 'alice',
        start_date: '2026-10-01T00:00:00',
        end_date: '2026-10-15T00:00:00',
        daily_pay: '100.000 SBD',
        subject: 'Dev fund',
        permlink: 'dev-fund-post',
      },
    ]);
  });

  it('vault identity session creates a proposal without any Redux key', async () => {
    const { onSuccess } = renderCreator(vaultStore());
    fillCreatorForm();
    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.broadcastProposalCreate).toHaveBeenCalledTimes(1);
    expect(mocks.loginFormCalls).toHaveLength(0);
  });

  it('keyless privateKey: needsClassicReauth opens the account-locked re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    const { onSuccess } = renderCreator(privateKeyStore('alice', false));
    fillCreatorForm();
    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.broadcastProposalCreate).not.toHaveBeenCalled();
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: 'alice',
      requiredAuthTypes: ['active'],
    });
  });
});

/* ───────── ProposalRemoveDialog (remove_proposal) ───────── */

function renderRemove(store: TestStore) {
  const onSuccess = vi.fn();
  render(
    <Provider store={store}>
      <ProposalRemoveDialog
        open
        onOpenChange={vi.fn()}
        proposalId={7}
        username="alice"
        onSuccess={onSuccess}
        onNeedLogin={vi.fn()}
      />
    </Provider>
  );
  return { onSuccess };
}

function confirmRemove() {
  fireEvent.change(screen.getByLabelText('removeConfirmId'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'removeButton' }));
}

describe('ProposalRemoveDialog × session signing (A6-T4)', () => {
  it('privateKey with key: byte-identical remove_proposal tuple at the active floor', async () => {
    const { onSuccess } = renderRemove(privateKeyStore('alice', true));
    confirmRemove();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.broadcastProposalRemove).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'remove_proposal',
      { proposal_owner: 'alice', proposal_ids: [7] },
    ]);
  });

  it('vault identity session removes a proposal without any Redux key', async () => {
    const { onSuccess } = renderRemove(vaultStore());
    confirmRemove();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.broadcastProposalRemove).toHaveBeenCalledTimes(1);
  });

  it('keyless privateKey: needsClassicReauth opens the account-locked re-auth dialog', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    const { onSuccess } = renderRemove(privateKeyStore('alice', false));
    confirmRemove();

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.broadcastProposalRemove).not.toHaveBeenCalled();
  });
});

/* ───────── WitnessVoteForm (account_witness_vote / account_witness_proxy) ───────── */

function renderWitness(store: TestStore) {
  return render(
    <Provider store={store}>
      <WitnessVoteForm />
    </Provider>
  );
}

async function voteOnWitnessRow() {
  // One table witness -> the enabled "vote" button is the row action (the
  // quick-vote button renders immediately but stays disabled with an empty
  // custom witness input, so wait for an ENABLED match).
  const rowButton = await waitFor(() => {
    const voteButtons = screen.getAllByRole('button', { name: 'vote' });
    const enabled = voteButtons.find((button) => !button.hasAttribute('disabled'));
    if (!enabled) throw new Error('witness row has not rendered an enabled vote button yet');
    return enabled;
  });
  fireEvent.click(rowButton);
}

async function setProxy(proxy: string) {
  // The label's text is the echoed i18n key of proxyTitle (htmlFor="proxy").
  fireEvent.change(await screen.findByLabelText('proxyTitle'), { target: { value: proxy } });
  fireEvent.click(screen.getByRole('button', { name: 'proxySet' }));
}

describe('WitnessVoteForm × session signing (A6-T4)', () => {
  it('privateKey with key: byte-identical account_witness_vote tuple at the active floor', async () => {
    renderWitness(privateKeyStore('alice', true));
    await voteOnWitnessRow();

    await waitFor(() => expect(mocks.broadcastWitnessVote).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'account_witness_vote',
      { account: 'alice', witness: 'witness1', approve: true },
    ]);
    expect(userActionRecord).toHaveBeenCalledWith('account_witness_vote', {
      username: 'alice',
      witness: 'witness1',
    });
  });

  it('vault identity session votes through the password path — NO login dialog, NO notice (retirement pin)', async () => {
    renderWitness(vaultStore());
    await voteOnWitnessRow();

    await waitFor(() => expect(mocks.broadcastWitnessVote).toHaveBeenCalledTimes(1));
    // The pre-A6 signingKey gate re-opened the login dialog for a keyless
    // vault session (which, with the old conditional fixedUsername pin,
    // reached the Vault Mode "unsupported" notice). Neither renders now.
    expect(mocks.loginFormCalls).toHaveLength(0);
    expect(screen.queryByTestId('vault-mode-unsupported')).not.toBeInTheDocument();
  });

  it('keyless privateKey: needsClassicReauth opens re-auth and does NOT update the local votes', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    renderWitness(privateKeyStore('alice', false));
    await voteOnWitnessRow();

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.broadcastWitnessVote).not.toHaveBeenCalled();
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: 'alice',
      requiredAuthTypes: ['active'],
    });
    // No optimistic vote was recorded: the row still offers "vote". (The
    // open re-auth dialog aria-hides the page tree, so query with hidden.)
    await waitFor(() => {
      const voteButtons = screen.getAllByRole('button', { name: 'vote', hidden: true });
      expect(voteButtons.some((button) => !button.hasAttribute('disabled'))).toBe(true);
    });
  });

  it('proxy: byte-identical account_witness_proxy tuple; vault session completes', async () => {
    renderWitness(vaultStore());
    await setProxy('bob');

    await waitFor(() => expect(mocks.broadcastWitnessProxy).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const request = mocks.sign.mock.calls[0]![0];
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('active');
    expect(signedOperation()).toEqual([
      'account_witness_proxy',
      { account: 'alice', proxy: 'bob' },
    ]);
    expect(userActionRecord).toHaveBeenCalledWith('account_witness_proxy', {
      username: 'alice',
      proxy: 'bob',
    });
  });

  it('anonymous visitor: the sign-in dialog asks for the active authority, no fixed username', async () => {
    const anonStore = configureStore({
      reducer: { auth: authReducer },
      preloadedState: { auth: BASE_AUTH },
    });
    renderWitness(anonStore);
    // Any vote attempt from an anonymous visitor opens the login dialog.
    await voteOnWitnessRow();

    await waitFor(() => expect(screen.getByTestId('login-form-probe')).toBeInTheDocument());
    expect(mocks.loginFormCalls.at(-1)).toEqual({
      fixedUsername: undefined,
      requiredAuthTypes: ['active'],
    });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
