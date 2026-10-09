/**
 * LoginForm — Steem Keychain login path.
 *
 * Private-key login is unchanged and covered by login-form-reauth.test.tsx;
 * this file covers the additive Keychain branch: the button only appears
 * once `window.steem_keychain` is detected, a successful Keychain login
 * reuses the existing `/api/auth/login` contract (same apiClient.login call
 * a raw-key login makes) and dispatches setKeychainCredentials, and an
 * owner-authority requirement is rejected without ever calling Keychain.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { TooltipProvider } from '@/components/ui/tooltip';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/test/transfers',
}));

const mockGetChallenge = vi.fn();
const mockLogin = vi.fn();
vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {
    isValidPrivateKey: vi.fn(),
    privateKeyToPublicKey: vi.fn(),
    signChallenge: vi.fn(),
    verifyPrivateKey: vi.fn(),
  },
  apiClient: {
    getAccounts: vi.fn(),
    getChallenge: (...args: unknown[]) => mockGetChallenge(...args),
    login: (...args: unknown[]) => mockLogin(...args),
  },
}));

const mockKeychainSignBuffer = vi.fn();
let keychainInstalled = true;
vi.mock('@/lib/steem/keychain', () => ({
  isKeychainInstalled: () => keychainInstalled,
  keychainSignBuffer: (...args: unknown[]) => mockKeychainSignBuffer(...args),
}));

import { LoginForm } from '@/components/auth/login-form';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function makeStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderForm(props: Parameters<typeof LoginForm>[0]) {
  const store = makeStore();
  const utils = render(
    <Provider store={store}>
      <TooltipProvider>
        <LoginForm {...props} />
      </TooltipProvider>
    </Provider>
  );
  return { store, ...utils };
}

describe('LoginForm — Steem Keychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keychainInstalled = true;
    mockGetChallenge.mockResolvedValue({ challenge: 'login-challenge' });
    mockLogin.mockResolvedValue({ success: true });
    mockKeychainSignBuffer.mockResolvedValue({
      publicKey: 'STM6KeychainPub',
      signature: 'KEYCHAIN_SIG',
    });
  });

  it('shows the Keychain button once the extension is detected', async () => {
    renderForm({ embedded: true, fixedUsername: 'testuser001' });
    expect(await screen.findByRole('button', { name: 'loginWithKeychain' })).toBeInTheDocument();
  });

  it('hides the Keychain button and shows the install hint when not installed', async () => {
    keychainInstalled = false;
    renderForm({ embedded: true, fixedUsername: 'testuser001' });
    await waitFor(() =>
      expect(screen.getByText('keychainNotInstalled')).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'loginWithKeychain' })).not.toBeInTheDocument();
  });

  it('signs the challenge via Keychain and logs in through the existing auth route', async () => {
    const onLoginSuccess = vi.fn();
    const { store } = renderForm({
      embedded: true,
      fixedUsername: 'testuser001',
      onLoginSuccess,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'loginWithKeychain' }));

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalled());
    expect(mockGetChallenge).toHaveBeenCalledWith('testuser001');
    expect(mockKeychainSignBuffer).toHaveBeenCalledWith(
      'testuser001',
      'login-challenge',
      'Posting'
    );
    expect(mockLogin).toHaveBeenCalledWith('testuser001', 'KEYCHAIN_SIG', 'STM6KeychainPub');

    const state = store.getState().auth;
    expect(state.isAuthenticated).toBe(true);
    expect(state.authMethod).toBe('keychain');
    expect(state.username).toBe('testuser001');
    expect(state.publicKey).toBe('STM6KeychainPub');
    // No raw key exists for a Keychain session.
    expect(state.activeKey).toBeNull();
    expect(state.postingKey).toBeNull();
    expect(state.ownerKey).toBeNull();
  });

  it('surfaces the server login error inline without touching the session', async () => {
    mockLogin.mockResolvedValue({ success: false, error: 'account not found' });
    const { store } = renderForm({ embedded: true, fixedUsername: 'testuser001' });

    fireEvent.click(await screen.findByRole('button', { name: 'loginWithKeychain' }));

    await waitFor(() => expect(screen.getByText('account not found')).toBeInTheDocument());
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });

  it('surfaces a Keychain extension error (e.g. user cancelled) inline', async () => {
    mockKeychainSignBuffer.mockRejectedValue(new Error('Request was cancelled'));
    renderForm({ embedded: true, fixedUsername: 'testuser001' });

    fireEvent.click(await screen.findByRole('button', { name: 'loginWithKeychain' }));

    await waitFor(() => expect(screen.getByText('Request was cancelled')).toBeInTheDocument());
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('rejects an owner-authority requirement without ever calling Keychain', async () => {
    renderForm({
      embedded: true,
      fixedUsername: 'testuser001',
      requiredAuthTypes: ['owner'],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'loginWithKeychain' }));

    await waitFor(() => expect(screen.getByText('insufficientAuthority')).toBeInTheDocument());
    expect(mockKeychainSignBuffer).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
