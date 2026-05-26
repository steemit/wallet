'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { SteemLogo } from './steem-logo';
import { useTheme } from '@/lib/theme';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { LoginForm } from '@/components/auth/login-form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Menu, Wallet, Settings, LogOut, Sun, Moon, Monitor } from 'lucide-react';

interface HeaderProps {
  onOpenSidePanel?: () => void;
}

export function Header({ onOpenSidePanel }: HeaderProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const { theme, cycleTheme } = useTheme();
  const { username, isAuthenticated, logout } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  const signupUrl = process.env.NEXT_PUBLIC_SIGNUP_URL ?? 'https://signup.steemit.com';

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const themeIcon =
    theme === 'dark' ? (
      <Moon data-icon="inline-start" />
    ) : theme === 'light' ? (
      <Sun data-icon="inline-start" />
    ) : (
      <Monitor data-icon="inline-start" />
    );
  const themeLabel =
    theme === 'dark' ? 'Dark Mode' : theme === 'light' ? 'Light Mode' : 'Original Mode';

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'
      )}
    >
      <nav className="flex h-16 items-center px-4 md:px-6">
        <div className="flex-shrink-0">
          <Link
            href="/"
            className="flex h-[37px] items-baseline text-accent-foreground transition-colors duration-200 hover:text-primary"
          >
            <SteemLogo />
          </Link>
        </div>

        <div className="ml-auto flex h-16 items-center gap-2 md:gap-4">
          {!isAuthenticated && (
            <div className="hidden items-center gap-4 md:flex">
              <Button
                type="button"
                variant="ghost"
                className="text-base font-medium"
                onClick={() => setLoginOpen(true)}
              >
                {t('login')}
              </Button>
              <Button asChild>
                <a href={signupUrl} target="_blank" rel="noopener noreferrer">
                  {t('signUp')}
                </a>
              </Button>
            </div>
          )}

          {isAuthenticated && username && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" className="rounded-full">
                  <Avatar size="lg">
                    <AvatarImage
                      src={`https://steemitimages.com/u/${username}/avatar`}
                      alt={username}
                    />
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm font-bold">
                      {username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href={`/@${username}/transfers`} className="cursor-pointer">
                    <Wallet data-icon="inline-start" />
                    <span>Wallet</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={cycleTheme} className="cursor-pointer">
                  {themeIcon}
                  <span>{themeLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/@${username}/settings`} className="cursor-pointer">
                    <Settings data-icon="inline-start" />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut data-icon="inline-start" />
                  <span>{t('logout')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSidePanel}
            aria-label="Menu"
          >
            <Menu />
          </Button>
        </div>
      </nav>

      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('login')}</DialogTitle>
            <DialogDescription className="sr-only">{t('login')}</DialogDescription>
          </DialogHeader>
          <Suspense
            fallback={
              <div className="space-y-4 py-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            }
          >
            <LoginForm embedded onLoginSuccess={() => setLoginOpen(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>
    </header>
  );
}
