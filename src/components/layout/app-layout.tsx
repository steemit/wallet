'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useState } from 'react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="min-h-screen">
        <Header onOpenSidePanel={() => setSidePanelOpen(true)} />
        <SidePanel open={sidePanelOpen} onOpenChange={setSidePanelOpen} />
        <main className="pt-16">{children}</main>
      </div>
    </TooltipProvider>
  );
}
