'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronDown, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const POLONIEX_STEEM_TRX = 'https://poloniex.com/trade/STEEM_TRX/?type=spot';

const externalNavLinkClassName =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/80 hover:text-accent-foreground';

export interface AccountWalletNavProps {
  accountname: string;
  socialUrl?: string;
  isMyAccount: boolean;
  showOwnerWalletNav?: boolean;
}

/**
 * Single wallet area nav: balances, rewards, delegations, owner tabs, then Blog + Buy STEEM (plain external links, right).
 */
export function AccountWalletNav({
  accountname,
  socialUrl = 'https://steemit.com',
  isMyAccount,
  showOwnerWalletNav = false,
}: AccountWalletNavProps) {
  const t = useTranslations('wallet');
  const pathname = usePathname();

  // showOwnerWalletNav uses localStorage (remembered device user); SSR always sees false.
  // Defer applying it until after mount so the first client paint matches the server HTML.
  const [ownerNavReady, setOwnerNavReady] = useState(false);
  useEffect(() => {
    setOwnerNavReady(true);
  }, []);

  const showExtraTabs = !!(isMyAccount || (ownerNavReady && showOwnerWalletNav));

  const isRewardsActive =
    pathname?.includes('/curation-rewards') || pathname?.includes('/author-rewards');

  const navInactive =
    'inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/80 hover:text-accent-foreground';
  const navActive =
    'inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold bg-accent text-accent-foreground';

  const isPathActive = (segment: string) => pathname?.includes(segment) ?? false;

  const transfersHref = `/@${accountname}/transfers`;
  const delegationsHref = `/@${accountname}/delegations`;
  const permissionsHref = `/@${accountname}/permissions`;
  const communitiesHref = `/@${accountname}/communities`;
  const passwordHref = `/@${accountname}/password`;

  const balancesActive = isPathActive('/transfers');
  const delegationsActive = isPathActive('/delegations');
  const permissionsActive = isPathActive('/permissions');
  const communitiesActive = isPathActive('/communities');
  const passwordActive = isPathActive('/password');

  return (
    <div className="UserProfile__top-nav border-b border-border">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 min-[480px]:py-5">
          <ul className="AccountWalletNav flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 sm:gap-x-2 md:gap-x-2.5">
            <li>
              <Link
                href={transfersHref}
                className={cn(balancesActive && !isRewardsActive ? navActive : navInactive)}
              >
                {t('balances')}
              </Link>
            </li>
            <li>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isRewardsActive
                      ? 'bg-accent font-semibold text-accent-foreground data-[state=open]:bg-accent data-[state=open]:hover:bg-accent/90'
                      : 'text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground data-[state=open]:bg-accent/80 data-[state=open]:text-accent-foreground data-[state=open]:hover:bg-accent'
                  )}
                >
                  Rewards <ChevronDown className="size-3 opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem asChild>
                    <a href={`/@${accountname}/curation-rewards`}>Curation Rewards</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/@${accountname}/author-rewards`}>Author Rewards</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li>
              <Link href={delegationsHref} className={cn(delegationsActive ? navActive : navInactive)}>
                {t('delegations')}
              </Link>
            </li>
            {showExtraTabs && (
              <>
                <li>
                  <Link
                    href={permissionsHref}
                    className={cn(permissionsActive ? navActive : navInactive)}
                  >
                    {t('keysAndPermissions')}
                  </Link>
                </li>
                <li>
                  <Link
                    href={communitiesHref}
                    className={cn(communitiesActive ? navActive : navInactive)}
                  >
                    {t('communities')}
                  </Link>
                </li>
                <li>
                  <Link href={passwordHref} className={cn(passwordActive ? navActive : navInactive)}>
                    {t('changePassword')}
                  </Link>
                </li>
              </>
            )}
          </ul>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 sm:pl-4">
            <a
              href={`${socialUrl.replace(/\/$/, '')}/@${accountname}`}
              target="_blank"
              rel="noopener noreferrer"
              className={externalNavLinkClassName}
            >
              {t('blog')}
              <ExternalLink className="size-3.5 shrink-0 opacity-90" aria-hidden />
            </a>
            <a
              href={POLONIEX_STEEM_TRX}
              target="_blank"
              rel="noopener noreferrer"
              className={externalNavLinkClassName}
            >
              {t('buySteem')}
              <ExternalLink className="size-3.5 shrink-0 opacity-90" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
