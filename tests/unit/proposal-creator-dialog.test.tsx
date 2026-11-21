/**
 * ProposalCreatorDialog normalization tests.
 *
 * The ownership gate compares the typed creator against the session user
 * case- and '@'-insensitively (sameSteemAccount), so a mixed-case typed
 * creator ("Alice") passes. The chain, however, only accepts canonical
 * lowercase account names — the signed create_proposal op must therefore
 * carry normalized creator/receiver names, or the user gets a relay/chain
 * rejection instead of the previous early validation toast.
 *
 * Since A6-T4 signing goes through useSessionSigning (mocked at its module
 * boundary); the normalization assertions read the create_proposal tuple
 * handed to the unified entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { ProposalCreatorDialog } from '@/components/proposals/proposal-creator-dialog';

// jsdom lacks ResizeObserver, required by radix-ui primitives.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  sign: vi.fn().mockResolvedValue({ status: 'signed', result: { signedTx: { signed: true } } }),
  broadcastCreate: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => <div data-testid="reauth-login-form" />,
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    broadcastProposalCreate: (...args: unknown[]) => mocks.broadcastCreate(...args),
  },
}));

function renderDialog() {
  const onSuccess = vi.fn();
  const store = configureStore({ reducer: { auth: authReducer } });
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

/** The create_proposal payload of the (only) signing request. */
function signedCreatePayload(): { creator?: string; receiver?: string } {
  const request = mocks.sign.mock.calls[0]?.[0] as {
    operations: Array<[string, Record<string, unknown>]>;
  };
  const payload = request.operations[0]?.[1];
  if (!payload) throw new Error('expected a create_proposal payload');
  return payload as { creator?: string; receiver?: string };
}

function fillForm(overrides: { creator?: string; receiver?: string; permlink?: string } = {}) {
  fireEvent.change(screen.getByLabelText('createTitle'), { target: { value: 'Dev fund' } });
  fireEvent.change(screen.getByLabelText('createDailyAmount'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('createStartDate'), {
    target: { value: '2026-10-01T00:00' },
  });
  fireEvent.change(screen.getByLabelText('createEndDate'), {
    target: { value: '2026-10-15T00:00' },
  });
  fireEvent.change(screen.getByLabelText('createPermlink'), {
    target: { value: overrides.permlink ?? 'dev-fund-post' },
  });
  fireEvent.change(screen.getByLabelText('createCreator'), {
    target: { value: overrides.creator ?? 'Alice' },
  });
  fireEvent.change(screen.getByLabelText('createReceiver'), {
    target: { value: overrides.receiver ?? '@Alice' },
  });
}

describe('ProposalCreatorDialog — normalized names in the signed op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs create_proposal with canonical lowercase creator and receiver', async () => {
    const { onSuccess } = renderDialog();
    fillForm({ creator: 'Alice', receiver: '@Alice' });

    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const payload = signedCreatePayload();
    expect(payload.creator).toBe('alice');
    expect(payload.receiver).toBe('alice');
    expect(mocks.broadcastCreate).toHaveBeenCalledTimes(1);
  });

  it('normalizes the creator parsed from a mixed-case permlink when fields fall back', async () => {
    const { onSuccess } = renderDialog();
    fillForm({
      permlink: 'https://steemit.com/@Alice/dev-fund-post',
      creator: '',
      receiver: '',
    });

    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const payload = signedCreatePayload();
    expect(payload.creator).toBe('alice');
    expect(payload.receiver).toBe('alice');
  });

  it('still blocks a creator that is a different account', async () => {
    renderDialog();
    fillForm({ creator: 'bob' });

    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('createMustSignAsCreator')
    );
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.broadcastCreate).not.toHaveBeenCalled();
  });
});
