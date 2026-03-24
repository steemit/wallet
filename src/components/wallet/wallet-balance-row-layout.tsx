'use client';

import { cn } from '@/lib/utils';

/**
 * Layout for wallet-legacy UserWallet rows: Foundation .column.medium-8 + .medium-4.
 * Implemented with Tailwind grid (shadcn-friendly) — no horizontal padding on the row shell;
 * text sits in grid cells, matching legacy column gutter via gap-x-6.
 */
export function WalletBalanceRowShell({
  className,
  zebra,
  borderless,
  children,
}: {
  className?: string;
  /** Zebra striping (legacy .zebra on the same row as .UserWallet__balance). */
  zebra?: boolean;
  /** Omit bottom border (e.g. last power-down notice). */
  borderless?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'UserWallet__balance py-4 px-4',
        !borderless && 'border-b border-border',
        zebra && 'bg-zebra',
        className
      )}
    >
      {children}
    </div>
  );
}

export function WalletBalanceRowColumns({
  left,
  right,
  className,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2 md:grid-cols-12 md:gap-x-6 md:gap-y-0',
        className
      )}
    >
      <div className="min-w-0 md:col-span-8">{left}</div>
      <div className="min-w-0 text-right md:col-span-4">{right}</div>
    </div>
  );
}
