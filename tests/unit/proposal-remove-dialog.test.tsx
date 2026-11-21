/**
 * ProposalRemoveDialog signing normalization tests (#341 residual).
 *
 * The dialog used to pass the raw session username into
 * SteemSigner.signRemoveProposal. Login-time normalization happens to make
 * that lowercase today, but nothing in the dialog enforced it — the signed
 * remove_proposal op must carry the canonical lowercase account name
 * (mirrors proposal-creator-dialog.tsx, see its test for the create side),
 * or a mixed-case session value would ship an op the chain rejects.
 *
 * Since A6-T4 signing goes through useSessionSigning (mocked at its module
 * boundary); the normalization assertions read the remove_proposal tuple
 * handed to the unified entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { ProposalRemoveDialog } from '@/components/proposals/proposal-remove-dialog';

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
  broadcastRemove: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/hooks/use-session-signing', () => ({
  useSessionSigning: () => ({ sign: mocks.sign, dialog: null }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => <div data-testid="reauth-login-form" />,
}));

vi.mock('@/lib/steem/client', () => ({
  apiClient: {
    broadcastProposalRemove: (...args: unknown[]) => mocks.broadcastRemove(...args),
  },
}));

function renderDialog(username: string) {
  const onSuccess = vi.fn();
  const store = configureStore({ reducer: { auth: authReducer } });
  render(
    <Provider store={store}>
      <ProposalRemoveDialog
        open
        onOpenChange={vi.fn()}
        proposalId={7}
        username={username}
        onSuccess={onSuccess}
        onNeedLogin={vi.fn()}
      />
    </Provider>
  );
  return { onSuccess };
}

/** The remove_proposal payload of the (only) signing request. */
function signedRemovePayload(): { proposal_owner?: string; proposal_ids?: number[] } {
  const request = mocks.sign.mock.calls[0]?.[0] as {
    operations: Array<[string, Record<string, unknown>]>;
  };
  const payload = request.operations[0]?.[1];
  if (!payload) throw new Error('expected a remove_proposal payload');
  return payload as { proposal_owner?: string; proposal_ids?: number[] };
}

function confirmAndSubmit() {
  fireEvent.change(screen.getByLabelText('removeConfirmId'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'removeButton' }));
}

describe('ProposalRemoveDialog — normalized name in the signed op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs remove_proposal with the canonical lowercase account name', async () => {
    // Mixed case + leading '@' in the session username must not reach the op.
    const { onSuccess } = renderDialog('@Alice');
    confirmAndSubmit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const payload = signedRemovePayload();
    expect(payload.proposal_owner).toBe('alice');
    expect(payload.proposal_ids).toEqual([7]);
    expect(mocks.broadcastRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps an already-canonical session username unchanged', async () => {
    const { onSuccess } = renderDialog('alice');
    confirmAndSubmit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(signedRemovePayload().proposal_owner).toBe('alice');
  });

  it('does not sign when the confirmation id does not match', async () => {
    renderDialog('alice');
    fireEvent.change(screen.getByLabelText('removeConfirmId'), {
      target: { value: '8' },
    });
    // The submit button is gated on idMatches; even a forced submit must
    // stop at the mismatch toast without signing.
    fireEvent.submit(screen.getByRole('button', { name: 'removeButton' }).closest('form')!);

    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('removeIdMismatch')
    );
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.broadcastRemove).not.toHaveBeenCalled();
  });
});
