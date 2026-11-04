/**
 * WorkModeSwitcher (A5) — the PrivateKey/Vault dual selector.
 *
 * Pins the kickoff A5 acceptance semantics:
 *  - both modes selectable, PrivateKey carries the Legacy/Deprecated badge;
 *  - the switcher works WITHOUT any login state (no Redux provider mounted);
 *  - a successful switch updates the selection in place (the hook contract —
 *    the e2e spec proves the no-reload half in a real browser);
 *  - a FAILED switch keeps showing the previous mode and surfaces the mapped
 *    VaultError code instead of the English message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkModeSwitcher } from '@/components/vault/work-mode-switcher';
import { VaultError } from '@/lib/vault/errors';
import type { SigningFacade } from '@/lib/vault/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// jsdom lacks ResizeObserver (radix-ui internals).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

function makeFacade(initialMode: 'privateKey' | 'vault' = 'privateKey'): {
  facade: SigningFacade;
  setSigningMode: ReturnType<typeof vi.fn>;
} {
  const setSigningMode = vi.fn();
  const facade = {
    getSigningMode: vi.fn().mockResolvedValue(initialMode),
    setSigningMode,
    signOperations: vi.fn(),
    signResolvedTransaction: vi.fn(),
  } as unknown as SigningFacade & { setSigningMode: ReturnType<typeof vi.fn> };
  return { facade, setSigningMode };
}

function radio(name: string) {
  return screen.getByRole('radio', { name: new RegExp(name) });
}

describe('WorkModeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both modes with the PrivateKey Legacy badge and no login dependency', async () => {
    const { facade } = makeFacade('privateKey');
    // Deliberately NO Redux/NextIntl providers — the mode is a device
    // preference, not a login-scoped feature.
    render(<WorkModeSwitcher facade={facade} />);

    expect(await screen.findByRole('radio', { name: /modePrivateKeyTitle/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /modeVaultTitle/ })).toBeInTheDocument();
    // Deprecated annotation on the legacy option (i18n mock renders keys).
    expect(screen.getByText('modePrivateKeyBadge')).toBeInTheDocument();
    // The vault option has no badge.
    expect(screen.queryByText('modeVaultBadge')).not.toBeInTheDocument();
  });

  it('checks the persisted initial mode', async () => {
    const { facade } = makeFacade('vault');
    render(<WorkModeSwitcher facade={facade} />);
    await waitFor(() => {
      expect(radio('modeVaultTitle')).toHaveAttribute('aria-checked', 'true');
    });
    expect(radio('modePrivateKeyTitle')).toHaveAttribute('aria-checked', 'false');
  });

  it('switches to vault mode in place on success and notifies the parent', async () => {
    const { facade, setSigningMode } = makeFacade('privateKey');
    const onModeChange = vi.fn();
    render(<WorkModeSwitcher facade={facade} onModeChange={onModeChange} />);

    await waitFor(() => {
      expect(radio('modePrivateKeyTitle')).toHaveAttribute('aria-checked', 'true');
    });
    fireEvent.click(radio('modeVaultTitle'));

    await waitFor(() => {
      expect(setSigningMode).toHaveBeenCalledWith('vault');
    });
    // Local state updated — no reload/navigation API exists in this tree.
    await waitFor(() => {
      expect(radio('modeVaultTitle')).toHaveAttribute('aria-checked', 'true');
    });
    // Parent got the transition (initial load + the switch).
    expect(onModeChange).toHaveBeenCalledWith('privateKey');
    expect(onModeChange).toHaveBeenCalledWith('vault');
  });

  it('keeps the previous mode and shows the mapped code when the switch fails', async () => {
    const { facade, setSigningMode } = makeFacade('privateKey');
    setSigningMode.mockRejectedValue(
      new VaultError('VAULT_STORAGE_UNAVAILABLE', 'english internal message'),
    );
    render(<WorkModeSwitcher facade={facade} />);

    await waitFor(() => {
      expect(radio('modePrivateKeyTitle')).toHaveAttribute('aria-checked', 'true');
    });
    fireEvent.click(radio('modeVaultTitle'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('errors.VAULT_STORAGE_UNAVAILABLE');
    });
    // The English message never reaches the UI; the selection is unchanged.
    expect(screen.getByRole('alert')).not.toHaveTextContent('english internal message');
    expect(radio('modePrivateKeyTitle')).toHaveAttribute('aria-checked', 'true');
    expect(radio('modeVaultTitle')).toHaveAttribute('aria-checked', 'false');
  });

  it('maps unexpected (non-VaultError) failures to the generic message', async () => {
    const { facade, setSigningMode } = makeFacade('privateKey');
    setSigningMode.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<WorkModeSwitcher facade={facade} />);

    await waitFor(() => {
      expect(radio('modePrivateKeyTitle')).toHaveAttribute('aria-checked', 'true');
    });
    fireEvent.click(radio('modeVaultTitle'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('errors.unexpected');
    });
    errorSpy.mockRestore();
  });

  it('disables interactions while a switch is in flight', async () => {
    let resolveSwitch: (value: void) => void = () => undefined;
    const { facade, setSigningMode } = makeFacade('privateKey');
    setSigningMode.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSwitch = resolve;
        }),
    );
    render(<WorkModeSwitcher facade={facade} />);

    await waitFor(() => {
      expect(radio('modePrivateKeyTitle')).not.toBeDisabled();
    });
    fireEvent.click(radio('modeVaultTitle'));

    await waitFor(() => {
      expect(radio('modeVaultTitle')).toBeDisabled();
    });
    expect(radio('modePrivateKeyTitle')).toBeDisabled();
    expect(screen.getByText('switching')).toBeInTheDocument();

    resolveSwitch();
    await waitFor(() => {
      expect(radio('modeVaultTitle')).not.toBeDisabled();
    });
  });

  it('renders the unavailable state without a facade', async () => {
    render(<WorkModeSwitcher facade={null} />);
    // Derived failure: retry affordance visible, radios disabled.
    expect(await screen.findByText('modeLoadFailed')).toBeInTheDocument();
    expect(radio('modePrivateKeyTitle')).toBeDisabled();
    expect(radio('modeVaultTitle')).toBeDisabled();
  });
});
