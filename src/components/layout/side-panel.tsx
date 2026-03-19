'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import {
  Wallet,
  ExternalLink,
  Vote,
  FileText,
  ChartCandlestick,
  LogIn,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidePanel({ open, onOpenChange }: SidePanelProps) {
  const t = useTranslations('wallet');
  const tAuth = useTranslations('auth');
  const pathname = usePathname();
  const username = useSelector((state: RootState) => state.auth.username);
  const isLoggedIn = !!username;

  const socialUrl = 'https://steemit.com';
  const signupUrl = process.env.NEXT_PUBLIC_SIGNUP_URL ?? 'https://signup.steemit.com';

  const navItemClassName =
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0';
  const activeNavItemClassName = 'bg-accent text-accent-foreground';

  const getNavItemClassName = (href: string, muted = false) => {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    return cn(navItemClassName, isActive && activeNavItemClassName, muted && 'text-muted-foreground');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[280px] sm:w-[320px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <SteemLogo />
          </SheetTitle>
        </SheetHeader>

        <nav className="mt-6 flex flex-col gap-1">
          <div className="px-2 py-1">
            <LanguageSwitcher onLocaleSelected={() => onOpenChange(false)} />
          </div>

          {isLoggedIn && (
            <>
              <p className="px-2 pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('navAccount')}
              </p>
              <Link
                href={`/@${username}/transfers`}
                onClick={() => onOpenChange(false)}
                className={getNavItemClassName(`/@${username}/transfers`)}
              >
                <Wallet />
                {t('title')}
              </Link>
              <Link
                href={`${socialUrl}/@${username}`}
                target="_blank"
                onClick={() => onOpenChange(false)}
                className={navItemClassName}
              >
                <ExternalLink />
                {t('blog')}
              </Link>
              <Separator className="my-2" />
            </>
          )}

          <p className="px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('navDiscover')}
          </p>

          <Link
            href="/witnesses"
            onClick={() => onOpenChange(false)}
            className={getNavItemClassName('/witnesses')}
          >
            <Vote />
            {t('witnesses')}
          </Link>
          <Link
            href="/proposals"
            onClick={() => onOpenChange(false)}
            className={getNavItemClassName('/proposals')}
          >
            <FileText />
            {t('proposals')}
          </Link>
          <Link
            href="/market"
            onClick={() => onOpenChange(false)}
            className={getNavItemClassName('/market')}
          >
            <ChartCandlestick />
            {t('market')}
          </Link>

          {!isLoggedIn && (
            <>
              <Separator className="my-2" />
              <p className="px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('navAccess')}
              </p>
              <Link
                href="/login"
                onClick={() => onOpenChange(false)}
                className={getNavItemClassName('/login', true)}
              >
                <LogIn />
                {tAuth('login')}
              </Link>
              <a
                href={signupUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => onOpenChange(false)}
                className={cn(navItemClassName, 'text-muted-foreground')}
              >
                <UserPlus />
                {tAuth('signUp')}
              </a>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
