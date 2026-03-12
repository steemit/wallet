'use client';

import { Header } from './header';
import { useTheme } from '@/lib/theme';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isMounted } = useTheme();

  // Prevent FOUC by hiding content until theme is loaded
  if (!isMounted) {
    return null;
  }

  return (
    <div className="App min-h-screen">
      <Header />
      <div className="App__content pt-16">
        {children}
      </div>
    </div>
  );
}
