/**
 * ProposalRemoveDialog signing normalization tests (#341 residual).
 *
 * The dialog used to pass the raw session username into
 * SteemSigner.signRemoveProposal. Login-time normalization happens to make
 * that lowercase today, but nothing in the dialog enforced it — the signed
 * remove_proposal op must carry the canonical lowercase account name
 * (mirrors proposal-creator-dialog.tsx, see its test for the create side),
 * or a mixed-case session value would ship an op the chain rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('@/hooks/use-auth', () => ({
  useActiveSigningKey: () => '5J-test-active-key',
}));

const mockSignRemoveProposal = vi.fn().mockResolvedValue({ signed: true });
const mockBroadcastRemove = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signRemoveProposal: (...args: unknown[]) => mockSignRemoveProposal(...args),
  },
  apiClient: {
    broadcastProposalRemove: (...args: unknown[]) => mockBroadcastRemove(...args),
  },
}));

function renderDialog(username: string) {
  const onSuccess = vi.fn();
  render(
    <ProposalRemoveDialog
      open
      onOpenChange={vi.fn()}
      proposalId={7}
      username={username}
      onSuccess={onSuccess}
      onNeedLogin={vi.fn()}
    />
  );
  return { onSuccess };
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
    expect(mockSignRemoveProposal).toHaveBeenCalledTimes(1);
    expect(mockSignRemoveProposal).toHaveBeenCalledWith('alice', [7], '5J-test-active-key');
    expect(mockBroadcastRemove).toHaveBeenCalledTimes(1);
  });

  it('keeps an already-canonical session username unchanged', async () => {
    const { onSuccess } = renderDialog('alice');
    confirmAndSubmit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mockSignRemoveProposal).toHaveBeenCalledWith('alice', [7], '5J-test-active-key');
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
    expect(mockSignRemoveProposal).not.toHaveBeenCalled();
    expect(mockBroadcastRemove).not.toHaveBeenCalled();
  });
});
