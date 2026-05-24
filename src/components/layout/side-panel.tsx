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
  LogIn,
  UserPlus,
  HelpCircle,
  ChartCandlestick,
  ShieldAlert,
  KeyRound,
  Vote,
  FileText,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SIDE_PANEL_EXTERNAL, SIDE_PANEL_INTERNAL } from '@/lib/navigation/side-panel-links';

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
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium text-foreground transition-colors outline-none hover:bg-accent/80 hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0';
  const activeNavItemClassName = 'bg-accent font-semibold text-accent-foreground';
  const externalNavItemClassName = cn(navItemClassName, 'justify-between');

  const getNavItemClassName = (href: string, muted = false) => {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);
    return cn(navItemClassName, isActive && activeNavItemClassName, muted && 'text-muted-foreground');
  };

  const close = () => onOpenChange(false);

  const internalLinks = [
    { href: SIDE_PANEL_INTERNAL.faq, label: t('navFaq'), icon: HelpCircle },
    { href: SIDE_PANEL_INTERNAL.market, label: t('navCurrencyMarket'), icon: ChartCandlestick },
    {
      href: SIDE_PANEL_INTERNAL.recoverAccount,
      label: t('navStolenAccountRecovery'),
      icon: ShieldAlert,
    },
    {
      href: isLoggedIn ? `/@${username}/password` : SIDE_PANEL_INTERNAL.changePassword,
      label: t('navChangeAccountPassword'),
      icon: KeyRound,
    },
    { href: SIDE_PANEL_INTERNAL.witnesses, label: t('navVoteForWitnesses'), icon: Vote },
    { href: SIDE_PANEL_INTERNAL.proposals, label: t('navSteemProposals'), icon: FileText },
  ] as const;

  const exchangeLinks = [
    { href: SIDE_PANEL_EXTERNAL.binance, label: 'Binance' },
    { href: SIDE_PANEL_EXTERNAL.poloniex, label: 'Poloniex' },
  ] as const;

  const resourceExternalLinks = [
    { href: SIDE_PANEL_EXTERNAL.apiDocs, label: t('navApiDocs') },
    { href: SIDE_PANEL_EXTERNAL.bluepaper, label: t('navBluepaper') },
    { href: SIDE_PANEL_EXTERNAL.smtWhitepaper, label: t('navSmtWhitepaper') },
    { href: SIDE_PANEL_EXTERNAL.whitepaper, label: t('navWhitepaper') },
  ] as const;

  const resourceInternalLinks = [
    { href: SIDE_PANEL_INTERNAL.about, label: t('navAbout') },
    { href: SIDE_PANEL_INTERNAL.privacy, label: t('navPrivacyPolicy') },
    { href: SIDE_PANEL_INTERNAL.terms, label: t('navTermsOfService') },
  ] as const;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[280px] overflow-y-auto sm:w-[320px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <SteemLogo />
          </SheetTitle>
        </SheetHeader>

        <nav className="mt-6 flex flex-col gap-1 pb-6">
          <div className="px-2 py-1">
            <LanguageSwitcher onLocaleSelected={close} />
          </div>

          {isLoggedIn && (
            <>
              <p className="px-2 pt-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                {t('navAccount')}
              </p>
              <Link
                href={`/@${username}/transfers`}
                onClick={close}
                className={getNavItemClassName(`/@${username}/transfers`)}
              >
                <Wallet />
                {t('title')}
              </Link>
              <Link
                href={`${socialUrl}/@${username}`}
                target="_blank"
                rel="noreferrer"
                onClick={close}
                className={navItemClassName}
              >
                <ExternalLink />
                {t('blog')}
              </Link>
              <Separator className="my-2" />
            </>
          )}

          {internalLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={close} className={getNavItemClassName(href)}>
              <Icon />
              {label}
            </Link>
          ))}

          <Separator className="my-2" />

          <p className="text-muted-foreground px-2 py-1 text-sm font-normal">{t('navThirdPartyExchanges')}</p>
          {exchangeLinks.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className={externalNavItemClassName}
            >
              <span>{label}</span>
              <ExternalLink className="text-muted-foreground" aria-hidden />
            </a>
          ))}

          <Separator className="my-2" />

          {resourceExternalLinks.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className={externalNavItemClassName}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="size-4 shrink-0" aria-hidden />
                {label}
              </span>
              <ExternalLink className="text-muted-foreground" aria-hidden />
            </a>
          ))}

          {resourceInternalLinks.map(({ href, label }) => (
            <Link key={href} href={href} onClick={close} className={getNavItemClassName(href)}>
              {label}
            </Link>
          ))}

          {!isLoggedIn && (
            <>
              <Separator className="my-2" />
              <p className="px-2 pt-1 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                {t('navAccess')}
              </p>
              <Link href="/login" onClick={close} className={getNavItemClassName('/login', true)}>
                <LogIn />
                {tAuth('login')}
              </Link>
              <a
                href={signupUrl}
                target="_blank"
                rel="noreferrer"
                onClick={close}
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
