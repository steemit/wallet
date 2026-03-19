'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WalletSubMenuProps {
  accountname: string;
  isMyAccount: boolean;
}

export function WalletSubMenu({ accountname, isMyAccount }: WalletSubMenuProps) {
  const t = useTranslations('wallet');
  const pathname = usePathname();

  const links = [
    { href: `/@${accountname}/transfers`, label: t('balances', { defaultMessage: 'Balances' }) },
    { href: `/@${accountname}/delegations`, label: t('delegations', { defaultMessage: 'Delegations' }) },
    ...(isMyAccount ? [
      { href: `/@${accountname}/permissions`, label: 'Permissions' },
      { href: `/@${accountname}/password`, label: 'Change Password' },
      { href: `/@${accountname}/communities`, label: 'Communities' },
    ] : []),
  ];

  const handleBuySteem = (e: React.MouseEvent) => {
    e.preventDefault();
    const newWindow = window.open();
    if (newWindow) {
      newWindow.opener = null;
      newWindow.location.href = 'https://poloniex.com/trade/STEEM_TRX/?type=spot';
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <ul className="WalletSubMenu flex flex-wrap gap-1">
        {links.map((link) => {
          const isActive = pathname?.includes(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  'inline-block px-3 py-2 text-base font-medium rounded-md transition-colors',
                  isActive
                    ? 'text-foreground font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {isMyAccount && (
        <Button
          variant="outline"
          size="default"
          onClick={handleBuySteem}
          className="e-btn-hollow font-bold"
        >
          {t('buySteem', { defaultMessage: 'Buy STEEM or STEEM POWER' })}
        </Button>
      )}
    </div>
  );
}
