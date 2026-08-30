'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DegradationBanner } from './degradation-banner';
import { OverseerPageTracker } from '@/components/analytics/overseer-page-tracker';
import { useState } from 'react';
import { Toaster } from 'sonner';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <OverseerPageTracker />
        <Toaster richColors closeButton />
        <Header onOpenSidePanel={() => setSidePanelOpen(true)} />
        <DegradationBanner />
        <SidePanel open={sidePanelOpen} onOpenChange={setSidePanelOpen} />
        <main>{children}</main>
      </div>
    </TooltipProvider>
  );
}
