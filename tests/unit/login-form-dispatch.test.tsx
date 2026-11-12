/**
 * LoginForm mode dispatcher (R3).
 *
 * `LoginForm` reads the persisted signing mode (through the REAL
 * useSigningMode hook over a mocked facade) and renders:
 *   - 'privateKey' (and every not-yet-'vault' state: loading, failed read,
 *     unavailable runtime)                        -> the classic form, as-is;
 *   - 'vault'                                     -> VaultLoginForm;
 *   - 'vault' + embedded re-auth (fixedUsername / requiredAuthTypes)
 *                                                 -> the explicit
 *     "not available in Vault Mode yet" notice + Work Mode shortcut.
 *
 * The PrivateKey branch's own behavior is pinned by the UNCHANGED
 * login-form-reauth.test.tsx (rendered without any VaultProvider — the
 * strongest evidence that the classic path is untouched).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/lib/store/slices/auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { VaultRuntime } from '@/components/vault/vault-manager';
import type { SigningFacade, SigningMode } from '@/lib/vault/types';
import {
  VAULT_WORK_MODE_CLOSED_EVENT,
  VAULT_WORK_MODE_OPEN_EVENT,
} from '@/components/vault/work-mode-events';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

let mockRuntime: VaultRuntime = { state: 'loading' };
vi.mock('@/components/vault/vault-manager', () => ({
  useVaultRuntime: () => mockRuntime,
}));

// Stub the vault form: this suite pins the DISPATCH, the form itself is
// covered by vault-login-form.test.tsx.
const vaultFormProps = vi.fn();
vi.mock('@/components/auth/vault-login-form', () => ({
  VaultLoginForm: (props: { embedded?: boolean; onLoginSuccess?: () => void }) => {
    vaultFormProps(props);
    return <div data-testid="vault-login-form-stub" data-embedded={String(!!props.embedded)} />;
  },
}));

const mockGetChallenge = vi.fn();
const mockLogin = vi.fn();
vi.mock('@/lib/steem/client', () => ({
  SteemSigner: {},
  apiClient: {
    getChallenge: (...args: unknown[]) => mockGetChallenge(...args),
    login: (...args: unknown[]) => mockLogin(...args),
  },
}));

import { LoginForm } from '@/components/auth/login-form';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function facadeWithMode(mode: SigningMode | Error): SigningFacade {
  return {
    getSigningMode: vi.fn(() =>
      mode instanceof Error ? Promise.reject(mode) : Promise.resolve(mode),
    ),
    setSigningMode: vi.fn(),
    signOperations: vi.fn(),
    signResolvedTransaction: vi.fn(),
  } as unknown as SigningFacade;
}

function readyRuntime(mode: SigningMode | Error): VaultRuntime {
  return { state: 'ready', manager: {} as never, facade: facadeWithMode(mode) };
}

function renderLogin(props: Parameters<typeof LoginForm>[0] = {}) {
  const store = configureStore({ reducer: { auth: authReducer } });
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <LoginForm {...props} />
      </TooltipProvider>
    </Provider>,
  );
}

/** The classic form is identified by its private-key (password) input. */
const privateKeyInput = () => screen.queryByPlaceholderText('secretPlaceholder');

describe('LoginForm mode dispatch (R3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRuntime = { state: 'loading' };
  });

  it("'privateKey' mode renders the classic form unchanged", async () => {
    const facade = facadeWithMode('privateKey');
    mockRuntime = { state: 'ready', manager: {} as never, facade };
    renderLogin();

    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'loginButton' })).toBeInTheDocument();
    // Stays on the classic form after the mode read settles.
    await waitFor(() => {
      expect(facade.getSigningMode).toHaveBeenCalled();
    });
    // Let the mode promise settle and its state update commit.
    await act(async () => {
      await Promise.resolve();
    });
    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
  });

  it("'vault' mode renders the vault identity form — no private-key input, no auth calls", async () => {
    mockRuntime = readyRuntime('vault');
    renderLogin();

    expect(await screen.findByTestId('vault-login-form-stub')).toBeInTheDocument();
    expect(privateKeyInput()).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(mockGetChallenge).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("'vault' mode + plain embedded usage (header login modal) passes embedded + onLoginSuccess through", async () => {
    mockRuntime = readyRuntime('vault');
    const onLoginSuccess = vi.fn();
    renderLogin({ embedded: true, onLoginSuccess });

    const stub = await screen.findByTestId('vault-login-form-stub');
    expect(stub).toHaveAttribute('data-embedded', 'true');
    expect(vaultFormProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ embedded: true, onLoginSuccess }),
    );
  });

  it("'vault' mode + embedded re-auth with fixedUsername shows the explicit unsupported notice", async () => {
    mockRuntime = readyRuntime('vault');
    const onOpen = vi.fn();
    window.addEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
    renderLogin({ embedded: true, fixedUsername: 'alice' });

    const notice = await screen.findByTestId('vault-mode-unsupported');
    expect(notice).toHaveTextContent('vaultUnsupportedTitle');
    expect(notice).toHaveTextContent('vaultUnsupportedBody');
    // Neither a silently-degraded identity form nor the private-key form.
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
    expect(privateKeyInput()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'vaultSwitchMode' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    window.removeEventListener(VAULT_WORK_MODE_OPEN_EVENT, onOpen);
  });

  it("'vault' mode + embedded re-auth with requiredAuthTypes shows the notice too", async () => {
    mockRuntime = readyRuntime('vault');
    renderLogin({ embedded: true, requiredAuthTypes: ['active'] });

    expect(await screen.findByTestId('vault-mode-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
    expect(privateKeyInput()).not.toBeInTheDocument();
  });

  it('embedded re-auth in privateKey mode keeps the classic locked-username form', async () => {
    const facade = facadeWithMode('privateKey');
    mockRuntime = { state: 'ready', manager: {} as never, facade };
    renderLogin({ embedded: true, fixedUsername: 'alice', requiredAuthTypes: ['active'] });

    expect(privateKeyInput()).toBeInTheDocument();
    expect((document.getElementById('wallet-reauth-username') as HTMLInputElement).value).toBe(
      'alice',
    );
    await waitFor(() => {
      expect(facade.getSigningMode).toHaveBeenCalled();
    });
    // Let the mode promise settle and its state update commit.
    await act(async () => {
      await Promise.resolve();
    });
    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.queryByTestId('vault-mode-unsupported')).not.toBeInTheDocument();
  });

  it('mode not resolved yet (runtime loading) renders the classic form (persisted default)', () => {
    mockRuntime = { state: 'loading' };
    renderLogin();
    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
  });

  it('vault storage unavailable renders the classic form (login never hard-depends on IndexedDB)', () => {
    mockRuntime = { state: 'unavailable', code: 'VAULT_STORAGE_UNAVAILABLE', retry: vi.fn() };
    renderLogin();
    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
  });

  it('a failed mode read keeps the classic form', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuntime = readyRuntime(new Error('settings read failed'));
    renderLogin();

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
    });
    expect(privateKeyInput()).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('re-reads the mode when the Work Mode modal closes — a switch back to PrivateKey swaps the surface in place', async () => {
    // The mode switch itself happens inside the modal (another
    // useSigningMode instance); this mounted surface learns about it only
    // through the closed-event re-read (e2e-caught staleness bug, 2026-11-05).
    const getSigningMode = vi
      .fn<() => Promise<import('@/lib/vault/types').SigningMode>>()
      .mockResolvedValueOnce('vault')
      .mockResolvedValue('privateKey');
    const facade = {
      getSigningMode,
      setSigningMode: vi.fn(),
      signOperations: vi.fn(),
      signResolvedTransaction: vi.fn(),
    } as unknown as SigningFacade;
    mockRuntime = { state: 'ready', manager: {} as never, facade };
    renderLogin();

    expect(await screen.findByTestId('vault-login-form-stub')).toBeInTheDocument();
    expect(privateKeyInput()).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
    });

    expect(await screen.findByPlaceholderText('secretPlaceholder')).toBeInTheDocument();
    expect(screen.queryByTestId('vault-login-form-stub')).not.toBeInTheDocument();
    expect(getSigningMode).toHaveBeenCalledTimes(2);
  });
});
