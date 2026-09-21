/**
 * RecoverAccountConfirmationPage flow tests (broadcast-failure UX regression).
 *
 * Pins the B-2 fixes:
 * 1. A broadcast failure after a successful confirm must surface a visible
 *    error state (NOT the success panel) and report the recovery_account
 *    analytics event with status='broadcast_failed'.
 * 2. When the record is already 'closed' (verify record_status='closed'),
 *    submitting goes straight to the broadcast — confirm is NOT re-run
 *    (its CAS would reject the closed record and brick the retry).
 * 3. The success panel links to /login (localePrefix 'never') with
 *    msg=accountrecovered, not the legacy /login.html.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock next-intl: return the key so assertions can match translated strings.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockVerifyRecoveryCode = vi.fn();
const mockGetOwnerHistory = vi.fn();
const mockConfirmAccountRecovery = vi.fn();
const mockBroadcastRecoverAccountTx = vi.fn();
const mockPrivateKeyToPublicKey = vi.fn();
const mockDerivePrivateKeyFromPassword = vi.fn();
const mockIsValidPrivateKey = vi.fn();
const mockSignRecoverAccount = vi.fn();
const mockUserActionRecord = vi.fn();

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    isValidPrivateKey: (...args: unknown[]) => mockIsValidPrivateKey(...args),
    privateKeyToPublicKey: (...args: unknown[]) => mockPrivateKeyToPublicKey(...args),
    derivePrivateKeyFromPassword: (...args: unknown[]) => mockDerivePrivateKeyFromPassword(...args),
    signRecoverAccount: (...args: unknown[]) => mockSignRecoverAccount(...args),
  },
  apiClient: {
    verifyRecoveryCode: (...args: unknown[]) => mockVerifyRecoveryCode(...args),
    getOwnerHistory: (...args: unknown[]) => mockGetOwnerHistory(...args),
    confirmAccountRecovery: (...args: unknown[]) => mockConfirmAccountRecovery(...args),
    broadcastRecoverAccountTx: (...args: unknown[]) => mockBroadcastRecoverAccountTx(...args),
  },
}));

vi.mock('@/lib/analytics/overseer', () => ({
  userActionRecord: (...args: unknown[]) => mockUserActionRecord(...args),
}));

import { RecoverAccountConfirmationPage } from '@/components/wallet/recover-account-confirmation-page';

const OLD_PUB = 'STM8OldOwnerPub';
const NEW_PUB = 'STM5NewOwnerPub';

function setupCommon() {
  // Passwords derive to OLD_PUB / NEW_PUB; old key is in owner history.
  // passwordToOwnerPubKey() → derivePrivateKeyFromPassword(username, pwd,
  // 'owner') → privateKeyToPublicKey(derivedKey); map both steps 1:1.
  mockIsValidPrivateKey.mockReturnValue(false);
  mockDerivePrivateKeyFromPassword.mockImplementation(
    (_username: unknown, password: string) => `wif:${password}`
  );
  mockPrivateKeyToPublicKey.mockImplementation((wif: string) =>
    wif === 'wif:new-password' ? NEW_PUB : OLD_PUB
  );
  mockGetOwnerHistory.mockResolvedValue({
    history: [{ previous_owner_authority: { key_auths: [[OLD_PUB, 1]] } }],
  });
  mockConfirmAccountRecovery.mockResolvedValue({ status: 'ok' });
  mockBroadcastRecoverAccountTx.mockResolvedValue({ success: true });
  mockSignRecoverAccount.mockResolvedValue({ signedTx: { operations: [] } });
  mockUserActionRecord.mockClear();
}

async function submitForm() {
  // The next-intl mock returns the message KEY, so labels resolve to
  // 'oldPassword' / 'newPassword' and the submit button to 'submit'.
  fireEvent.change(screen.getByLabelText('oldPassword'), {
    target: { value: 'old-password' },
  });
  fireEvent.change(screen.getByLabelText('newPassword'), {
    target: { value: 'new-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'submit' }));
}

describe('RecoverAccountConfirmationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommon();
  });

  it('renders the normal form for record_status=confirmed', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'ok',
      account_name: 'alice',
      record_status: 'confirmed',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('intro')).toBeInTheDocument();
    expect(mockVerifyRecoveryCode).toHaveBeenCalledWith('5bc350832943043e8a82');
  });

  it('runs confirm then broadcast; success panel links to /login with msg=accountrecovered', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'ok',
      account_name: 'alice',
      record_status: 'confirmed',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
    });

    await submitForm();

    await waitFor(() => {
      expect(screen.getByText('successMessage')).toBeInTheDocument();
    });
    expect(mockConfirmAccountRecovery).toHaveBeenCalledTimes(1);
    expect(mockBroadcastRecoverAccountTx).toHaveBeenCalledTimes(1);

    // B-3: real /login route, not the legacy /login.html that 404s.
    const link = screen.getByRole('link', { name: 'goToLogin' });
    expect(link.getAttribute('href')).toBe(
      '/login?account=alice&msg=accountrecovered'
    );

    // Success analytics keeps the legacy payload shape (no status field).
    expect(mockUserActionRecord).toHaveBeenCalledWith('recovery_account', {
      username: 'alice',
    });
  });

  it('broadcast failure shows a visible error with a retry, not success (B-2)', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'ok',
      account_name: 'alice',
      record_status: 'confirmed',
    });
    mockBroadcastRecoverAccountTx.mockResolvedValue({
      success: false,
      error: 'Failed to broadcast transaction',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
    });

    await submitForm();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // NOT the success state.
    expect(screen.queryByText('successMessage')).not.toBeInTheDocument();
    expect(screen.getByText('broadcastFailedTitle')).toBeInTheDocument();
    expect(screen.getByText('broadcastFailedBody')).toBeInTheDocument();
    expect(screen.getByText('Failed to broadcast transaction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retryBroadcast' })).toBeInTheDocument();

    // Failure analytics is distinguished from success.
    expect(mockUserActionRecord).toHaveBeenCalledWith('recovery_account', {
      username: 'alice',
      status: 'broadcast_failed',
    });
  });

  it('retry button re-runs only the broadcast (no second confirm) and can succeed', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'ok',
      account_name: 'alice',
      record_status: 'confirmed',
    });
    mockBroadcastRecoverAccountTx
      .mockResolvedValueOnce({ success: false, error: 'boom' })
      .mockResolvedValueOnce({ success: true });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
    });

    await submitForm();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'retryBroadcast' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'retryBroadcast' }));

    await waitFor(() => {
      expect(screen.getByText('successMessage')).toBeInTheDocument();
    });
    // Confirm ran exactly once; broadcast ran twice (initial + retry).
    expect(mockConfirmAccountRecovery).toHaveBeenCalledTimes(1);
    expect(mockBroadcastRecoverAccountTx).toHaveBeenCalledTimes(2);
  });

  it('record_status=closed goes straight to broadcast without re-running confirm (retry mode)', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'ok',
      account_name: 'alice',
      record_status: 'closed',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
    });
    // Retry-mode intro copy, not the normal one.
    expect(screen.getByText('retryModeIntro')).toBeInTheDocument();

    await submitForm();

    await waitFor(() => {
      expect(screen.getByText('successMessage')).toBeInTheDocument();
    });
    // Confirm must NOT be called — its CAS only accepts status='confirmed'
    // and would reject the closed record, bricking the retry.
    expect(mockConfirmAccountRecovery).not.toHaveBeenCalled();
    expect(mockBroadcastRecoverAccountTx).toHaveBeenCalledTimes(1);
  });

  it('maps verify record_status to localized status copy', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'error',
      error: 'Recovery request has not been approved yet',
      record_status: 'open',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);

    await waitFor(() => {
      expect(screen.getByText('statusNotApproved')).toBeInTheDocument();
    });
  });

  it('maps consumed record_status to localized status copy', async () => {
    mockVerifyRecoveryCode.mockResolvedValue({
      status: 'error',
      error: 'This recovery link has already been used to complete the account recovery.',
      record_status: 'consumed',
    });

    render(<RecoverAccountConfirmationPage code="5bc350832943043e8a82" />);

    await waitFor(() => {
      expect(screen.getByText('statusAlreadyUsed')).toBeInTheDocument();
    });
  });
});
