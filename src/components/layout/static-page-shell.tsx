import type { ReactNode } from 'react';

export function StaticPageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <h1 className="text-foreground mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}
