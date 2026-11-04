'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DegradationBanner } from './degradation-banner';
import { OverseerPageTracker } from '@/components/analytics/overseer-page-tracker';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { VaultProvider, VaultWorkModeContent } from '@/components/vault/vault-manager';
import { useTranslations } from 'next-intl';

/**
 * B-PHASE (dapp signing) WIRING POINT — dapp error → Work Mode drawer.
 *
 * When a B-phase dapp signing surface hits a mode-related vault error
 * (`VAULT_MODE_REQUIRED`, `VAULT_LOCKED`, ...), it should dispatch this
 * custom window event; the listener below opens the Work Mode drawer and
 * focuses the mode switcher so the user can switch modes / unlock:
 *
 *   window.dispatchEvent(new CustomEvent(VAULT_WORK_MODE_OPEN_EVENT));
 *
 * Deliberately a bare custom event (no payload) for now: B0–B4 are deferred,
 * so only the "open + focus" contract is reserved here. If B-phase needs to
 * convey WHICH error occurred, extend the event detail then.
 */
export const VAULT_WORK_MODE_OPEN_EVENT = 'steem-wallet:open-work-mode';

/** id of the focusable mode-switcher container inside the drawer. */
const WORK_MODE_SWITCHER_FOCUS_ID = 'work-mode-switcher';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('vault');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [workModeOpen, setWorkModeOpen] = useState(false);

  useEffect(() => {
    const openWorkMode = () => {
      setWorkModeOpen(true);
      // Focus the mode switcher once the drawer content has mounted.
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
          <Sheet open={workModeOpen} onOpenChange={setWorkModeOpen}>
            <SheetContent
              side="right"
              className="w-[320px] overflow-y-auto sm:w-[400px]"
              data-testid="work-mode-drawer"
            >
              <SheetHeader>
                <SheetTitle>{t('workModeTitle')}</SheetTitle>
              </SheetHeader>
              <VaultWorkModeContent focusId={WORK_MODE_SWITCHER_FOCUS_ID} />
            </SheetContent>
          </Sheet>
          <main>{children}</main>
        </div>
      </TooltipProvider>
    </VaultProvider>
  );
}
