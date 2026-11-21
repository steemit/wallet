/**
 * A6-T3b wallet callers × useSessionSigning integration — communities-section,
 * change-password-section and recovery-warning-banner in all three session
 * shapes. The hook is mocked at its module boundary (its routing matrix and
 * the password dialog live in use-session-signing.test.tsx); these tests pin
 * what each CALLER passes to the unified entry (byte-identical operation
 * tuples, role floors) and how it handles each outcome:
 *   - privateKey session with the key the caller historically required: the
 *     exact tuple the retired SteemSigner.* builder produced reaches the
 *     unified entry, and the broadcast follows on `signed`;
 *   - vault identity session (no Redux keys): the caller's own key gate
 *     widens for the page-matching vault session (the actions become
 *     available) and `cancelled` is a quiet no-op;
 *   - privateKey session missing its key: the pre-existing gate
 *     (activeKeyRequired notice / owner-key copy) keeps holding.
 *
 * claim-rewards-banner — the fourth T3b caller — has its own dedicated suite
 * (the remembered-key affordance needs storage spies).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { steem } from '@steemit/steem-js';
import authReducer, { setVaultIdentity, type AuthState } from '@/lib/store/slices/auth';
import { CommunitiesSection } from '@/components/wallet/communities-section';
import { ChangePasswordSection } from '@/components/wallet/change-password-section';
import { RecoveryWarningBanner } from '@/components/wallet/recovery-warning-banner';
import { SteemSigner, apiClient } from '@/lib/steem/client';
import { communityActiveWif } from '@/lib/wallet/community';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/@alice/transfers',
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ sign: vi.fn() }));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

// Real community builders; only the two sleeps are stubbed so the multi-step
// flow does not take 9 real seconds in jsdom.
vi.mock('@/lib/wallet/community', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/community')>();
  return { ...actual, sleep: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    // Remaining DIRECT signing: the hivemind setup ops signed with the NEW
    // community owner's freshly derived active key (no session holds it).
    signOperations: vi.fn().mockResolvedValue({ setup: 'signed' }),
    // change-password.ts validation helpers (non-signing) route through the
    // same module; the real derivation runs through steem-js below.
    isValidPrivateKey: vi.fn(() => false),
    privateKeyToPublicKey: vi.fn(),
  },
  apiClient: {
    broadcastCustomJson: vi.fn().mockResolvedValue({ success: true }),
    broadcastAccountCreate: vi.fn().mockResolvedValue({ success: true }),
    broadcastAccountUpdate: vi.fn().mockResolvedValue({ success: true }),
    broadcastChangeRecoveryAccount: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const signSetupOps = vi.mocked(SteemSigner.signOperations);
const broadcastCustomJson = vi.mocked(apiClient.broadcastCustomJson);
const broadcastAccountCreate = vi.mocked(apiClient.broadcastAccountCreate);
const broadcastAccountUpdate = vi.mocked(apiClient.broadcastAccountUpdate);
const broadcastChangeRecovery = vi.mocked(apiClient.broadcastChangeRecoveryAccount);

const fetchAccountsMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/steem/accounts-client', () => ({
  fetchAccounts: (...args: unknown[]) => fetchAccountsMock(...args),
}));

vi.mock('@/lib/cache/client-cache', () => ({
  clientCache: { invalidate: vi.fn() },
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: vi.fn(),
}));

vi.mock('@/hooks/use-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-auth')>();
  return {
    ...actual,
    useAuth: () => ({ username: 'alice', isAuthenticated: true, logout: vi.fn() }),
  };
});

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

function privateKeyStore(
  keys: { activeKey?: string | null; ownerKey?: string | null } = {},
) {
  const activeKey = keys.activeKey ?? null;
  const ownerKey = keys.ownerKey ?? null;
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        ...BASE_AUTH,
        username: 'alice',
        activeKey,
        ownerKey,
        privateKey: activeKey ?? ownerKey,
        isAuthenticated: true,
      } satisfies AuthState,
    },
  });
}

function vaultStore(username = 'alice') {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: BASE_AUTH },
  });
  store.dispatch(setVaultIdentity({ username }));
  return store;
}

const signedOutcome = () => ({
  status: 'signed' as const,
  result: { signedTx: { signatures: ['SIG'], operations: [] } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mocks.sign.mockResolvedValue(signedOutcome());
});

/* ───────── CommunitiesSection ───────── */

/** Drive the form to a submitted community creation; returns the credentials. */
async function submitCommunity(
  store: ReturnType<typeof privateKeyStore> | ReturnType<typeof vaultStore>,
) {
  const view = render(
    <Provider store={store}>
      <CommunitiesSection username="alice" isMyAccount />
    </Provider>,
  );
  fireEvent.change(screen.getByLabelText('titleLabel'), { target: { value: 'Test Community' } });
  fireEvent.click(screen.getByRole('button', { name: 'next' }));
  const code = await waitFor(() => {
    const el = view.container.querySelector('code');
    expect(el?.textContent).toBeTruthy();
    return el!;
  });
  // The block renders "{ownerName}<br/>{ownerPassword}": two text nodes.
  const parts = Array.from(code.childNodes)
    .map((node) => node.textContent ?? '')
    .filter((text) => text.length > 0);
  expect(parts).toHaveLength(2);
  const [ownerName, ownerPassword] = parts as [string, string];
  const checkboxes = screen.getAllByRole('checkbox');
  for (const box of checkboxes) fireEvent.click(box);
  fireEvent.click(screen.getByRole('button', { name: 'createButton' }));
  return { ownerName: ownerName ?? '', ownerPassword: ownerPassword ?? '' };
}

describe('CommunitiesSection × session signing (A6-T3b)', () => {
  it('privateKey with active key: account_create at the active floor, subscribe at the posting floor', async () => {
    const { ownerName, ownerPassword } = await submitCommunity(
      privateKeyStore({ activeKey: '5J-test-active' }),
    );

    await waitFor(() =>
      expect(broadcastCustomJson).toHaveBeenCalledTimes(2),
    );

    expect(mocks.sign).toHaveBeenCalledTimes(2);
    const [createReq, subscribeReq] = mocks.sign.mock.calls.map((c) => c[0]);
    // account_create: role floor 'active' (the previous useActiveSigningKey
    // resolution), payload from the same buildAccountCreateOperation builder.
    expect(createReq.accountName).toBe('alice');
    expect(createReq.role).toBe('active');
    const [createType, createPayload] = createReq.operations[0]!;
    expect(createType).toBe('account_create');
    expect(createPayload).toMatchObject({
      creator: 'alice',
      new_account_name: ownerName,
      fee: '3.000 STEEM',
      json_metadata: '',
    });
    expect(createPayload.owner.key_auths).toHaveLength(1);
    // subscribe: required_posting_auths custom_json → posting floor.
    expect(subscribeReq.accountName).toBe('alice');
    expect(subscribeReq.role).toBe('posting');
    expect(subscribeReq.operations).toEqual([
      [
        'custom_json',
        {
          required_auths: [],
          required_posting_auths: ['alice'],
          id: 'community',
          json: JSON.stringify(['subscribe', { community: ownerName }]),
        },
      ],
    ]);

    // The hivemind setup ops stay on the DIRECT signer, signed with the NEW
    // community owner's freshly derived active key (byte-identical legacy
    // path — that key exists in no session).
    expect(signSetupOps).toHaveBeenCalledTimes(1);
    const [setupOps, setupKeys] = signSetupOps.mock.calls[0]!;
    expect(setupOps).toHaveLength(2);
    for (const op of setupOps) {
      expect(op[0]).toBe('custom_json');
      expect(op[1].required_posting_auths).toEqual([ownerName]);
      expect(op[1].required_auths).toEqual([]);
    }
    expect(setupKeys).toEqual([communityActiveWif(ownerName, ownerPassword)]);
  });

  it('vault identity session: the form is available and the flow completes through the password path', async () => {
    await submitCommunity(vaultStore());

    await waitFor(() => expect(broadcastCustomJson).toHaveBeenCalledTimes(2));
    // The pre-A6 gate showed activeKeyRequired for the keyless vault session.
    expect(screen.queryByText('activeKeyRequired')).not.toBeInTheDocument();
    expect(broadcastAccountCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(broadcastCustomJson).toHaveBeenLastCalledWith(
      expect.objectContaining({ signatures: ['SIG'] }),
      'alice',
    );
    expect(screen.getByText('createdSuccess')).toBeInTheDocument();
  });

  it('keyless privateKey session keeps the activeKeyRequired gate (no form, no signing)', () => {
    render(
      <Provider store={privateKeyStore()}>
        <CommunitiesSection username="alice" isMyAccount />
      </Provider>,
    );
    expect(screen.getByText('activeKeyRequired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'createButton' })).not.toBeInTheDocument();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('a vault-dialog cancel during account creation surfaces the account error and broadcasts nothing', async () => {
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    await submitCommunity(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastAccountCreate).not.toHaveBeenCalled();
    expect(broadcastCustomJson).not.toHaveBeenCalled();
    expect(screen.getByText('accountCreateFailed')).toBeInTheDocument();
  });
});

/* ───────── ChangePasswordSection ───────── */

/** Master password whose derived role keys populate the chain fixture. */
const MASTER_PASSWORD = 'PMasterPasswordForFixture';
const rolePub = (role: 'owner' | 'active' | 'posting' | 'memo') =>
  steem.auth.wifToPublic(steem.auth.toWif('alice', MASTER_PASSWORD, role));

const ACCOUNT = {
  id: 1,
  name: 'alice',
  owner: { weight_threshold: 1, account_auths: [], key_auths: [[rolePub('owner'), 1]] },
  active: { weight_threshold: 1, account_auths: [], key_auths: [[rolePub('active'), 1]] },
  posting: { weight_threshold: 1, account_auths: [], key_auths: [[rolePub('posting'), 1]] },
  memo_key: rolePub('memo'),
  json_metadata: '',
};

/** Drive the change-password form to a submit; returns the generated password. */
async function submitChangePassword(
  store: ReturnType<typeof privateKeyStore> | ReturnType<typeof vaultStore>,
) {
  const view = render(
    <Provider store={store}>
      <ChangePasswordSection username="alice" isMyAccount />
    </Provider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'generateButton' }));
  const generated = await waitFor(() => {
    const code = view.container.querySelector('code');
    expect(code?.textContent).toMatch(/^P/);
    return code!.textContent!;
  });
  fireEvent.change(screen.getByLabelText('currentPassword'), {
    target: { value: MASTER_PASSWORD },
  });
  fireEvent.change(screen.getByLabelText('reEnterPassword'), {
    target: { value: generated },
  });
  for (const label of ['understandNoRecovery', 'savedConfirm']) {
    fireEvent.click(screen.getByLabelText(label));
  }
  fireEvent.click(screen.getByRole('button', { name: 'updatePassword' }));
  return generated;
}

describe('ChangePasswordSection × session signing (A6-T3b)', () => {
  it('privateKey with owner key: signs the account_update tuple at the owner floor and broadcasts', async () => {
    fetchAccountsMock.mockResolvedValue({ success: true, accounts: [ACCOUNT] });
    const generated = await submitChangePassword(
      privateKeyStore({ ownerKey: '5J-test-owner' }),
    );

    await waitFor(() => expect(broadcastAccountUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const req = mocks.sign.mock.calls[0]![0];
    expect(req.accountName).toBe('alice');
    expect(req.role).toBe('owner');
    const [type, payload] = req.operations[0]!;
    // Byte-identical to the retired SteemSigner.signAccountUpdate input: the
    // chain-normalized account_update rotating all four authorities.
    expect(type).toBe('account_update');
    expect(payload.account).toBe('alice');
    expect(payload.owner).toEqual({
      weight_threshold: 1,
      account_auths: [],
      key_auths: [[steem.auth.wifToPublic(steem.auth.toWif('alice', generated, 'owner')), 1]],
    });
    expect(payload.active.key_auths).toEqual([
      [steem.auth.wifToPublic(steem.auth.toWif('alice', generated, 'active')), 1],
    ]);
    expect(payload.posting.key_auths).toEqual([
      [steem.auth.wifToPublic(steem.auth.toWif('alice', generated, 'posting')), 1],
    ]);
    expect(payload.memo_key).toBe(
      steem.auth.wifToPublic(steem.auth.toWif('alice', generated, 'memo')),
    );
    expect(typeof payload.json_metadata).toBe('string');

    expect(broadcastAccountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ signatures: ['SIG'] }),
      'alice',
    );
    await waitFor(() => expect(screen.getByText('successMessage')).toBeInTheDocument());
  });

  it('vault identity session: the vault-password note renders and the flow completes', async () => {
    fetchAccountsMock.mockResolvedValue({ success: true, accounts: [ACCOUNT] });
    await submitChangePassword(vaultStore());

    // The two passwords stay clearly separate in the copy (the VAULT
    // password note is vault-session-only).
    expect(screen.getByText('vaultPasswordNote')).toBeInTheDocument();
    await waitFor(() => expect(broadcastAccountUpdate).toHaveBeenCalledTimes(1));
    expect(mocks.sign.mock.calls[0]![0].role).toBe('owner');
    await waitFor(() => expect(screen.getByText('successMessage')).toBeInTheDocument());
  });

  it('separation trap: the signing request carries NO password material, and a wrong vault password (promise pending) never touches derivation state', async () => {
    fetchAccountsMock.mockResolvedValue({ success: true, accounts: [ACCOUNT] });
    // A WRONG vault password keeps the dialog's promise PENDING (the dialog
    // stays open for an in-place retry) — model that from the first submit.
    mocks.sign.mockReturnValue(new Promise(() => {}));
    const view = render(
      <Provider store={vaultStore()}>
        <ChangePasswordSection username="alice" isMyAccount />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'generateButton' }));
    const generated = await waitFor(() => {
      const code = view.container.querySelector('code');
      expect(code?.textContent).toMatch(/^P/);
      return code!.textContent!;
    });
    fireEvent.change(screen.getByLabelText('currentPassword'), {
      target: { value: MASTER_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('reEnterPassword'), {
      target: { value: generated },
    });
    for (const label of ['understandNoRecovery', 'savedConfirm']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button', { name: 'updatePassword' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    // (a) The request object is EXACTLY {operations, accountName, role} —
    // the ACCOUNT password (form input, derives/verifies the NEW keys) is
    // never reused as, or conflated with, the vault password the dialog
    // asks for: no vaultPassword / keyIv / password field rides along.
    const request = mocks.sign.mock.calls[0]![0];
    expect(Object.keys(request).sort()).toEqual(['accountName', 'operations', 'role']);
    expect(request.accountName).toBe('alice');
    expect(request.role).toBe('owner');
    expect(JSON.stringify(request.operations)).not.toContain(MASTER_PASSWORD);
    expect(JSON.stringify(request.operations)).not.toContain(generated);

    // (b) While the dialog retries (promise pending), the caller must not
    // treat that as failure: derivation state is untouched, nothing
    // broadcasts and no error copy appears.
    expect(broadcastAccountUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText('broadcastFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('ownerKeySessionRequired')).not.toBeInTheDocument();
    expect(screen.queryByText('signingFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('successMessage')).not.toBeInTheDocument();
    // The generated (ACCOUNT) password display survives the aborted attempt
    // exactly as the user saved it.
    expect(view.container.querySelector('code')?.textContent).toBe(generated);
  });

  it('vault-dialog cancel is a quiet no-op: no broadcast, no error, derivation state untouched', async () => {
    fetchAccountsMock.mockResolvedValue({ success: true, accounts: [ACCOUNT] });
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });
    const view = render(
      <Provider store={vaultStore()}>
        <ChangePasswordSection username="alice" isMyAccount />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'generateButton' }));
    const generated = await waitFor(() => {
      const code = view.container.querySelector('code');
      expect(code?.textContent).toMatch(/^P/);
      return code!.textContent!;
    });
    fireEvent.change(screen.getByLabelText('currentPassword'), {
      target: { value: MASTER_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('reEnterPassword'), {
      target: { value: generated },
    });
    for (const label of ['understandNoRecovery', 'savedConfirm']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button', { name: 'updatePassword' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastAccountUpdate).not.toHaveBeenCalled();
    expect(screen.queryByText('broadcastFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('successMessage')).not.toBeInTheDocument();
    // The generated (ACCOUNT) password display survives the aborted signing.
    expect(view.container.querySelector('code')?.textContent).toBe(generated);
  });

  it('privateKey without an owner key: needsClassicReauth shows the owner-key copy and nothing broadcasts', async () => {
    fetchAccountsMock.mockResolvedValue({ success: true, accounts: [ACCOUNT] });
    mocks.sign.mockResolvedValueOnce({ status: 'needsClassicReauth' });
    const view = render(
      <Provider store={privateKeyStore({ activeKey: '5J-test-active' })}>
        <ChangePasswordSection username="alice" isMyAccount />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'generateButton' }));
    const generated = await waitFor(() => {
      const code = view.container.querySelector('code');
      expect(code?.textContent).toMatch(/^P/);
      return code!.textContent!;
    });
    fireEvent.change(screen.getByLabelText('currentPassword'), {
      target: { value: MASTER_PASSWORD },
    });
    fireEvent.change(screen.getByLabelText('reEnterPassword'), {
      target: { value: generated },
    });
    for (const label of ['understandNoRecovery', 'savedConfirm']) {
      fireEvent.click(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button', { name: 'updatePassword' }));

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastAccountUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('ownerKeySessionRequired')).toBeInTheDocument();
    // A wrong-session outcome never touches the derivation state: the form
    // keeps the generated password exactly as the user saved it.
    expect(view.container.querySelector('code')?.textContent).toBe(generated);
  });
});

/* ───────── RecoveryWarningBanner ───────── */

const FUTURE_ISO = '2030-01-01T00:00:00';
const RECOVERY_ACCOUNT_FIXTURE = {
  ...ACCOUNT,
  recovery_account: 'steem',
  account_recovery: {
    account_to_recover: 'alice',
    recovery_account: 'bob',
    effective_on: FUTURE_ISO,
  },
};

async function submitRecoveryChange(
  store: ReturnType<typeof privateKeyStore> | ReturnType<typeof vaultStore>,
) {
  render(
    <Provider store={store}>
      <RecoveryWarningBanner username="alice" isMyAccount />
    </Provider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'takeAction' }));
  const dialog = await screen.findByRole('dialog');
  const input = dialog.querySelector('#new-recovery-account') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '@Steem' } });
  fireEvent.click(screen.getByRole('button', { name: 'submit' }));
  return dialog;
}

describe('RecoveryWarningBanner × session signing (A6-T3b)', () => {
  it('privateKey with owner key: signs the byte-identical change_recovery_account tuple at the owner floor', async () => {
    fetchAccountsMock.mockResolvedValue({
      success: true,
      accounts: [RECOVERY_ACCOUNT_FIXTURE],
    });

    await submitRecoveryChange(privateKeyStore({ ownerKey: '5J-test-owner' }));

    await waitFor(() =>
      expect(broadcastChangeRecovery).toHaveBeenCalledTimes(1),
    );
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    // Exactly what SteemSigner.signChangeRecoveryAccount built.
    expect(mocks.sign).toHaveBeenCalledWith({
      operations: [
        [
          'change_recovery_account',
          {
            account_to_recover: 'alice',
            new_recovery_account: 'steem',
            extensions: [],
          },
        ],
      ],
      accountName: 'alice',
      role: 'owner',
    });
    expect(broadcastChangeRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ signatures: ['SIG'] }),
      'alice',
    );
  });

  it('vault identity session: the owner-key gate widens and the flow completes', async () => {
    fetchAccountsMock.mockResolvedValue({
      success: true,
      accounts: [RECOVERY_ACCOUNT_FIXTURE],
    });

    await submitRecoveryChange(vaultStore());

    // No owner key in Redux, yet the submit went through — the vault session
    // signs through the dialog, and success closes it (banner state clears).
    expect(screen.queryByText('ownerKeyRequired')).not.toBeInTheDocument();
    await waitFor(() => expect(broadcastChangeRecovery).toHaveBeenCalledTimes(1));
    expect(mocks.sign.mock.calls[0]![0].role).toBe('owner');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a vault-dialog cancel is a quiet no-op: dialog stays open, no broadcast, no error', async () => {
    fetchAccountsMock.mockResolvedValue({
      success: true,
      accounts: [RECOVERY_ACCOUNT_FIXTURE],
    });
    mocks.sign.mockResolvedValueOnce({ status: 'cancelled' });

    await submitRecoveryChange(vaultStore());

    await waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(1));
    expect(broadcastChangeRecovery).not.toHaveBeenCalled();
    // The dialog remains usable for another attempt: no error copy, the
    // submit button re-enables.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('failed')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'submit' })).toBeEnabled(),
    );
  });

  it('keyless privateKey session keeps the owner-key gate (disabled submit + notice)', async () => {
    fetchAccountsMock.mockResolvedValue({
      success: true,
      accounts: [RECOVERY_ACCOUNT_FIXTURE],
    });

    render(
      <Provider store={privateKeyStore()}>
        <RecoveryWarningBanner username="alice" isMyAccount />
      </Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'takeAction' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('ownerKeyRequired');
    expect(screen.getByRole('button', { name: 'submit' })).toBeDisabled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
