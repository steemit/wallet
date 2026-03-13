'use client';

import { Header } from './header';
import { SidePanel } from './side-panel';
import { useTheme } from '@/lib/theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useState } from 'react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isMounted } = useTheme();
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  // Prevent FOUC by hiding content until theme is loaded
  if (!isMounted) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="App min-h-screen">
        <Header onOpenSidePanel={() => setSidePanelOpen(true)} />
        <SidePanel open={sidePanelOpen} onOpenChange={setSidePanelOpen} />
        <div className="App__content pt-16">
          {children}
        </div>
      </div>
    </TooltipProvider>
  );
}
