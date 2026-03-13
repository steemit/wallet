'use client';

import Link from 'next/link';
import { useSelector } from 'react-redux';
import { RootState } from '@/lib/store';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { SteemLogo } from './steem-logo';
import {
  Wallet,
  ExternalLink,
  Vote,
  FileText,
} from 'lucide-react';

interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidePanel({ open, onOpenChange }: SidePanelProps) {
  const t = useTranslations('wallet');
  const username = useSelector((state: RootState) => state.auth.username);
  const isLoggedIn = !!username;

  const socialUrl = 'https://steemit.com';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[280px] sm:w-[320px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <SteemLogo />
          </SheetTitle>
        </SheetHeader>

        <nav className="mt-6 flex flex-col gap-1">
          {isLoggedIn && (
            <>
              <Link
                href={`/@${username}/transfers`}
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                <Wallet className="h-4 w-4" />
                {t('title')}
              </Link>
              <Link
                href={`${socialUrl}/@${username}`}
                target="_blank"
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Blog
              </Link>
            </>
          )}

          <Separator className="my-2" />

          <Link
            href="/witnesses"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <Vote className="h-4 w-4" />
            {t('witnesses')}
          </Link>
          <Link
            href="/proposals"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <FileText className="h-4 w-4" />
            Proposals
          </Link>
          <Link
            href="/market"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Market
          </Link>

          {!isLoggedIn && (
            <>
              <Separator className="my-2" />
              <Link
                href="/login"
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Login
              </Link>
              <Link
                href="/signup"
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
