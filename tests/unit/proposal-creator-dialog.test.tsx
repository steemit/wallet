/**
 * ProposalCreatorDialog normalization tests.
 *
 * The ownership gate compares the typed creator against the session user
 * case- and '@'-insensitively (sameSteemAccount), so a mixed-case typed
 * creator ("Alice") passes. The chain, however, only accepts canonical
 * lowercase account names — the signed create_proposal op must therefore
 * carry normalized creator/receiver names, or the user gets a relay/chain
 * rejection instead of the previous early validation toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('@/hooks/use-auth', () => ({
  useActiveSigningKey: () => '5J-test-active-key',
}));

const mockSignCreateProposal = vi.fn().mockResolvedValue({ signed: true });
const mockBroadcastCreate = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    signCreateProposal: (...args: unknown[]) => mockSignCreateProposal(...args),
  },
  apiClient: {
    broadcastProposalCreate: (...args: unknown[]) => mockBroadcastCreate(...args),
  },
}));

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

function renderDialog() {
  const onSuccess = vi.fn();
  render(
    <ProposalCreatorDialog
      open
      onOpenChange={vi.fn()}
      username="alice"
      treasuryFeeSbd="10.000"
      onSuccess={onSuccess}
      onNeedLogin={vi.fn()}
    />
  );
  return { onSuccess };
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
    expect(mockSignCreateProposal).toHaveBeenCalledTimes(1);
    const [creator, receiver] = mockSignCreateProposal.mock.calls[0] as [string, string];
    expect(creator).toBe('alice');
    expect(receiver).toBe('alice');
    expect(mockBroadcastCreate).toHaveBeenCalledTimes(1);
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
    const [creator, receiver] = mockSignCreateProposal.mock.calls[0] as [string, string];
    expect(creator).toBe('alice');
    expect(receiver).toBe('alice');
  });

  it('still blocks a creator that is a different account', async () => {
    renderDialog();
    fillForm({ creator: 'bob' });

    fireEvent.click(screen.getByRole('button', { name: 'createSubmit' }));

    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('createMustSignAsCreator')
    );
    expect(mockSignCreateProposal).not.toHaveBeenCalled();
    expect(mockBroadcastCreate).not.toHaveBeenCalled();
  });
});
