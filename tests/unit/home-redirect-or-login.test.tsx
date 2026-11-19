/**
 * HomeRedirectOrLogin (root path) — Legacy remembered-username jump vs the
 * persisted signing mode (R3).
 *
 * PrivateKey Mode keeps the historical behavior: a device-remembered username
 * redirects to /@user/transfers, otherwise the login form renders. Vault Mode
 * skips the Legacy jump entirely (the remembered username / posting key
 * belong to the PrivateKey flow and are not even read) and renders the login
 * form, which dispatches to vault identity selection. The jump waits until
 * the mode is known; an unreadable mode keeps the PrivateKey default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { VaultRuntime } from '@/components/vault/vault-manager';
import type { SigningFacade, SigningMode } from '@/lib/vault/types';
import { REMEMBERED_USERNAME_KEY } from '@/lib/auth/browser-storage';

const mockReplace = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));

let mockRuntime: VaultRuntime = { state: 'loading' };
vi.mock('@/components/vault/vault-manager', () => ({
  useVaultRuntime: () => mockRuntime,
}));

// The dispatcher itself is covered by login-form-dispatch.test.tsx.
vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => <div data-testid="login-form-stub" />,
}));

import { HomeRedirectOrLogin } from '@/components/home/home-redirect-or-login';

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

describe('HomeRedirectOrLogin + signing mode (R3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRuntime = { state: 'loading' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('privateKey mode: a remembered username redirects to its transfers page (unchanged)', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    mockRuntime = readyRuntime('privateKey');
    render(<HomeRedirectOrLogin />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/@alice/transfers');
    });
    expect(screen.queryByTestId('login-form-stub')).not.toBeInTheDocument();
  });

  it('privateKey mode without a remembered username shows the login form', async () => {
    mockRuntime = readyRuntime('privateKey');
    render(<HomeRedirectOrLogin />);

    expect(await screen.findByTestId('login-form-stub')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('vault mode: NO Legacy remembered-username jump — the login form renders, the key is never read', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    const getItemSpy = vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, 'getItem');
    mockRuntime = readyRuntime('vault');
    render(<HomeRedirectOrLogin />);

    expect(await screen.findByTestId('login-form-stub')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalledWith(REMEMBERED_USERNAME_KEY);
    // Device data untouched.
    getItemSpy.mockRestore();
    expect(localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBe('alice');
  });

  it('waits for the mode: no jump and no form while the vault runtime is still loading', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    mockRuntime = { state: 'loading' };
    render(<HomeRedirectOrLogin />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('login-form-stub')).not.toBeInTheDocument();
  });

  it('vault storage unavailable keeps the PrivateKey default (remembered jump still works)', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    mockRuntime = { state: 'unavailable', code: 'VAULT_STORAGE_UNAVAILABLE', retry: vi.fn() };
    render(<HomeRedirectOrLogin />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/@alice/transfers');
    });
  });

  it('a failed mode read keeps the PrivateKey default (remembered jump still works)', async () => {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, 'alice');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRuntime = readyRuntime(new Error('settings read failed'));
    render(<HomeRedirectOrLogin />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/@alice/transfers');
    });
  });
});
