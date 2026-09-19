/**
 * LoginForm authority-gating tests (re-auth regression).
 *
 * Reproduces the reported bug: a session logged in with posting-only authority
 * opens a balance action (Transfer), gets the re-auth dialog, submits the same
 * posting credentials — the login POST succeeds, but the dialog silently stays
 * because the session still has no active/owner key. With requiredAuthTypes the
 * form must now fail loudly instead of looping with no feedback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';

// Mock next/navigation (LoginForm reads search params / navigates on success).
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

// Mock next-intl: return the key so assertions can match translated strings.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/test/transfers',
}));

const mockGetAccounts = vi.fn();
const mockGetChallenge = vi.fn();
const mockLogin = vi.fn();
const mockPrivateKeyToPublicKey = vi.fn();
const mockSignChallenge = vi.fn();
const mockIsValidPrivateKey = vi.fn();
const mockVerifyPrivateKey = vi.fn();

vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    isValidPrivateKey: (...args: unknown[]) => mockIsValidPrivateKey(...args),
    privateKeyToPublicKey: (...args: unknown[]) => mockPrivateKeyToPublicKey(...args),
    signChallenge: (...args: unknown[]) => mockSignChallenge(...args),
    verifyPrivateKey: (...args: unknown[]) => mockVerifyPrivateKey(...args),
  },
  apiClient: {
    getAccounts: (...args: unknown[]) => mockGetAccounts(...args),
    getChallenge: (...args: unknown[]) => mockGetChallenge(...args),
    login: (...args: unknown[]) => mockLogin(...args),
  },
}));

import { LoginForm } from '@/components/auth/login-form';

const ACCOUNT = {
  name: 'testuser001',
  owner: { key_auths: [['STM8OwnerPub', 1]], weight_threshold: 1, account_auths: [] },
  active: { key_auths: [['STM4ActivePub', 1]], weight_threshold: 1, account_auths: [] },
  posting: { key_auths: [['STM6PostingPub', 1]], weight_threshold: 1, account_auths: [] },
  memo_key: 'STM8MemoPub',
};

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderForm(props: Parameters<typeof LoginForm>[0]) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <LoginForm {...props} />
    </Provider>
  );
  return { store, ...utils };
}

function submitSecret(secret: string) {
  fireEvent.change(screen.getByPlaceholderText('secretPlaceholder'), {
    target: { value: secret },
  });
  fireEvent.click(screen.getByRole('button', { name: 'loginButton' }));
}

describe('LoginForm requiredAuthTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAccounts.mockResolvedValue({ accounts: [ACCOUNT] });
    mockGetChallenge.mockResolvedValue({ challenge: 'login-challenge' });
    mockLogin.mockResolvedValue({ success: true });
    mockSignChallenge.mockReturnValue('signed');
    mockIsValidPrivateKey.mockReturnValue(true);
    mockPrivateKeyToPublicKey.mockImplementation((wif: string) => {
      if (wif === '5KActiveWif') return 'STM4ActivePub';
      if (wif === '5KPostingWif') return 'STM6PostingPub';
      throw new Error('unknown wif');
    });
    mockVerifyPrivateKey.mockReturnValue(false);
  });

  it('rejects a posting-only login when active authority is required (loud error, no session)', async () => {
    const { store } = renderForm({
      embedded: true,
      fixedUsername: 'testuser001',
      requiredAuthTypes: ['active'],
    });

    submitSecret('5KPostingWif');

    await waitFor(() => {
      expect(screen.getByText('insufficientAuthority')).toBeInTheDocument();
    });
    // Session must NOT be upgraded with posting-only keys...
    expect(store.getState().auth.isAuthenticated).toBe(false);
    // ...and the server login was never even attempted.
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('accepts an active-key login when active authority is required', async () => {
    const onLoginSuccess = vi.fn();
    const { store } = renderForm({
      embedded: true,
      fixedUsername: 'testuser001',
      requiredAuthTypes: ['active'],
      onLoginSuccess,
    });

    submitSecret('5KActiveWif');

    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalled();
    });
    expect(store.getState().auth.activeKey).toBe('5KActiveWif');
    expect(screen.queryByText('insufficientAuthority')).not.toBeInTheDocument();
  });

  it('without requiredAuthTypes a posting-only login still succeeds (login page behaviour unchanged)', async () => {
    const { store } = renderForm({ embedded: true, fixedUsername: 'testuser001' });

    submitSecret('5KPostingWif');

    await waitFor(() => {
      expect(store.getState().auth.isAuthenticated).toBe(true);
    });
    expect(store.getState().auth.postingKey).toBe('5KPostingWif');
    expect(screen.queryByText('insufficientAuthority')).not.toBeInTheDocument();
  });

  it('embedded re-auth with hidden remember checkbox leaves remembered device data untouched', async () => {
    localStorage.setItem('wallet:rememberedUsername', 'testuser001');
    localStorage.setItem('wallet:rememberedPostingKey', '5KPostingWif');

    renderForm({
      embedded: true,
      fixedUsername: 'testuser001',
      requiredAuthTypes: ['active'],
    });

    submitSecret('5KActiveWif');

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalled();
    });
    expect(localStorage.getItem('wallet:rememberedUsername')).toBe('testuser001');
    expect(localStorage.getItem('wallet:rememberedPostingKey')).toBe('5KPostingWif');
  });
});
