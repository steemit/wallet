/**
 * AppLayout Work Mode modal wiring (A5 open event + R3 closed event).
 *
 * - VAULT_WORK_MODE_OPEN_EVENT on `window` opens the modal (the B-phase /
 *   R3 empty-state hook);
 * - closing the modal dispatches VAULT_WORK_MODE_CLOSED_EVENT so vault-derived
 *   views outside it (the R3 vault login form) re-read the public directory;
 * - the historical re-export from app-layout still names the same event.
 *
 * Heavy layout children (header, side panel, banners, the vault runtime) are
 * stubbed — this suite pins only the modal event contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/components/layout/header', () => ({ Header: () => null }));
vi.mock('@/components/layout/side-panel', () => ({ SidePanel: () => null }));
vi.mock('@/components/layout/degradation-banner', () => ({ DegradationBanner: () => null }));
vi.mock('@/components/analytics/overseer-page-tracker', () => ({
  OverseerPageTracker: () => null,
}));
vi.mock('sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/vault/vault-manager', () => ({
  VaultProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  VaultWorkModeContent: () => <div data-testid="work-mode-content-stub" />,
}));

import { AppLayout, VAULT_WORK_MODE_OPEN_EVENT as REEXPORTED_OPEN } from '@/components/layout/app-layout';
import {
  VAULT_WORK_MODE_CLOSED_EVENT,
  VAULT_WORK_MODE_OPEN_EVENT,
} from '@/components/vault/work-mode-events';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

describe('AppLayout Work Mode modal events', () => {
  it('keeps the historical re-export of the open event', () => {
    expect(REEXPORTED_OPEN).toBe(VAULT_WORK_MODE_OPEN_EVENT);
  });

  it('opens on the open event and dispatches the closed event when it closes', async () => {
    const onClosed = vi.fn();
    window.addEventListener(VAULT_WORK_MODE_CLOSED_EVENT, onClosed);
    render(
      <AppLayout>
        <p>page</p>
      </AppLayout>,
    );
    expect(screen.queryByTestId('work-mode-modal')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT));
    });
    expect(await screen.findByTestId('work-mode-modal')).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();

    // The single close path (Esc / outside clicks are blocked): the X button.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByTestId('work-mode-modal')).not.toBeInTheDocument();
    });
    expect(onClosed).toHaveBeenCalledTimes(1);
    window.removeEventListener(VAULT_WORK_MODE_CLOSED_EVENT, onClosed);
  });
});
