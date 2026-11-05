'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DegradationBanner } from './degradation-banner';
import { OverseerPageTracker } from '@/components/analytics/overseer-page-tracker';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { VaultProvider, VaultWorkModeContent } from '@/components/vault/vault-manager';
import {
  VAULT_WORK_MODE_CLOSED_EVENT,
  VAULT_WORK_MODE_OPEN_EVENT,
} from '@/components/vault/work-mode-events';
import { useTranslations } from 'next-intl';

/**
 * B-PHASE (dapp signing) WIRING POINT — dapp error → Work Mode modal.
 *
 * When a B-phase dapp signing surface hits a mode-related vault error
 * (`VAULT_MODE_REQUIRED`, `VAULT_LOCKED`, ...), it should dispatch this
 * custom window event; the listener below opens the Work Mode modal and
 * focuses the mode switcher so the user can switch modes / unlock:
 *
 *   window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT));
 *
 * Deliberately a bare custom event (no payload) for now: B0–B4 are deferred,
 * so only the "open + focus" contract is reserved here. If B-phase needs to
 * convey WHICH error occurred, extend the event detail then.
 *
 * The constant itself lives in the leaf module
 * `@/components/vault/work-mode-events` (shared with the R3 vault login form
 * without an import cycle); it is re-exported here to keep the historical
 * import path working. The same module defines VAULT_WORK_MODE_CLOSED_EVENT,
 * which this layout dispatches whenever the modal closes (R3: the vault login
 * form re-reads the public directory after in-modal management changes).
 */
export { VAULT_WORK_MODE_OPEN_EVENT } from '@/components/vault/work-mode-events';

/** id of the focusable mode-switcher container inside the modal. */
const WORK_MODE_SWITCHER_FOCUS_ID = 'work-mode-switcher';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('vault');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [workModeOpen, setWorkModeOpen] = useState(false);

  useEffect(() => {
    const openWorkMode = () => {
      setWorkModeOpen(true);
      // Focus the mode switcher once the modal content has mounted.
      requestAnimationFrame(() => {
        document.getElementById(WORK_MODE_SWITCHER_FOCUS_ID)?.focus();
      });
    };
    window.addEventListener(VAULT_WORK_MODE_OPEN_EVENT, openWorkMode);
    return () => window.removeEventListener(VAULT_WORK_MODE_OPEN_EVENT, openWorkMode);
  }, []);

  return (
    <VaultProvider>
      <TooltipProvider>
        <div className="min-h-screen">
          <OverseerPageTracker />
          <Toaster richColors closeButton />
          <Header onOpenSidePanel={() => setSidePanelOpen(true)} />
          <DegradationBanner />
          <SidePanel
            open={sidePanelOpen}
            onOpenChange={setSidePanelOpen}
            onOpenWorkMode={() => setWorkModeOpen(true)}
          />
          <Dialog
            open={workModeOpen}
            onOpenChange={(open) => {
              setWorkModeOpen(open);
              // Vault-derived views outside the modal refresh on close (all
              // vault management happens inside it). Esc / outside clicks are
              // blocked below, so this is the single close path.
              if (!open) window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_CLOSED_EVENT));
            }}
          >
            <DialogContent
              className="max-h-[85vh] overflow-y-auto p-0 sm:max-w-xl"
              onEscapeKeyDown={(event) => event.preventDefault()}
              onInteractOutside={(event) => event.preventDefault()}
              data-testid="work-mode-modal"
            >
              <DialogHeader className="p-4">
                <DialogTitle>{t('workModeTitle')}</DialogTitle>
              </DialogHeader>
              <VaultWorkModeContent focusId={WORK_MODE_SWITCHER_FOCUS_ID} />
            </DialogContent>
          </Dialog>
          <main>{children}</main>
        </div>
      </TooltipProvider>
    </VaultProvider>
  );
}
