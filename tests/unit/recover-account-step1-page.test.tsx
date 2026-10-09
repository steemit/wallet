/**
 * RecoverAccountStep1Page owner-history precheck tests.
 *
 * Pins the B-5 fix: the frontend precheck matches the derived owner public
 * key against the FULL key set of every previous owner authority (same
 * semantics as the relay server) — multi-key owner accounts must not be
 * wrongly rejected. The old password/key here derives to a fixed pub key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock next-intl: return the key so assertions can match translated strings.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockGetAccounts = vi.fn();
const mockGetOwnerHistory = vi.fn();
const mockInitiateAccountRecoveryWithEmail = vi.fn();
const mockPrivateKeyToPublicKey = vi.fn();
const mockDerivePrivateKeyFromPassword = vi.fn();
const mockIsValidPrivateKey = vi.fn();

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    isValidPrivateKey: (...args: unknown[]) => mockIsValidPrivateKey(...args),
    privateKeyToPublicKey: (...args: unknown[]) => mockPrivateKeyToPublicKey(...args),
    derivePrivateKeyFromPassword: (...args: unknown[]) => mockDerivePrivateKeyFromPassword(...args),
  },
  apiClient: {
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
    getOwnerHistory: (...args: unknown[]) => mockGetOwnerHistory(...args),
    initiateAccountRecoveryWithEmail: (...args: unknown[]) =>
      mockInitiateAccountRecoveryWithEmail(...args),
  },
}));

import { RecoverAccountStep1Page } from '@/components/wallet/recover-account-step-1-page';

const OWNER_PUB = 'STM6OwnerPubKey';

function setupCommon() {
  mockIsValidPrivateKey.mockReturnValue(false);
  mockDerivePrivateKeyFromPassword.mockImplementation(
    (_username: unknown, password: string) => `wif:${password}`
  );
  mockPrivateKeyToPublicKey.mockReturnValue(OWNER_PUB);
  // Account exists; no last_owner_update restriction.
  mockGetAccounts.mockResolvedValue({ accounts: [{ name: 'alice' }] });
}

async function fillAndBegin() {
  fireEvent.change(screen.getByLabelText('accountName'), {
    target: { value: 'alice' },
  });
  fireEvent.change(screen.getByLabelText('recentPassword'), {
    target: { value: 'recent-owner-password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'beginRecovery' }));
}

describe('RecoverAccountStep1Page owner-history precheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommon();
  });

  it('accepts when the derived key is the 2nd key of a multi-key previous owner authority', async () => {
    mockGetOwnerHistory.mockResolvedValue({
      history: [
        {
          previous_owner_authority: {
            key_auths: [
              ['STM5AnotherOwnerKey', 2],
              [OWNER_PUB, 1],
            ],
          },
        },
      ],
    });

    render(<RecoverAccountStep1Page />);
    await fillAndBegin();

    // Advances to the email step — the multi-key authority matched.
    await waitFor(() => {
      expect(screen.getByText('enterEmailToVerify')).toBeInTheDocument();
    });
    expect(mockGetOwnerHistory).toHaveBeenCalledWith('alice');
  });

  it('accepts a single-key authority match (first key)', async () => {
    mockGetOwnerHistory.mockResolvedValue({
      history: [{ previous_owner_authority: { key_auths: [[OWNER_PUB, 1]] } }],
    });

    render(<RecoverAccountStep1Page />);
    await fillAndBegin();

    await waitFor(() => {
      expect(screen.getByText('enterEmailToVerify')).toBeInTheDocument();
    });
  });

  it('rejects when the derived key matches no key in any authority key set', async () => {
    mockGetOwnerHistory.mockResolvedValue({
      history: [
        {
          previous_owner_authority: {
            key_auths: [
              ['STM5AnotherOwnerKey', 1],
              ['STM7YetAnotherKey', 1],
            ],
          },
        },
      ],
    });

    render(<RecoverAccountStep1Page />);
    await fillAndBegin();

    await waitFor(() => {
      expect(screen.getByText('passwordNotUsedInLastDays')).toBeInTheDocument();
    });
    // Does not advance to the email step.
    expect(screen.queryByText('enterEmailToVerify')).not.toBeInTheDocument();
    expect(mockInitiateAccountRecoveryWithEmail).not.toHaveBeenCalled();
  });
});
