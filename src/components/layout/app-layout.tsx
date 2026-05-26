'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DegradationBanner } from './degradation-banner';
import { useState } from 'react';
import { Toaster } from 'sonner';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <Toaster richColors closeButton />
        <Header onOpenSidePanel={() => setSidePanelOpen(true)} />
        <DegradationBanner />
        <SidePanel open={sidePanelOpen} onOpenChange={setSidePanelOpen} />
        <main className="pt-16">{children}</main>
      </div>
    </TooltipProvider>
  );
}
