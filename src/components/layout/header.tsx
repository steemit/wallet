'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/lib/store';
import { getRememberedDeviceUsername } from '@/lib/auth/browser-storage';
import { SteemLogo } from './steem-logo';
import { useTheme } from '@/lib/theme';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Menu, Wallet, Key, Settings, LogOut, Sun, Moon, Monitor } from 'lucide-react';

interface HeaderProps {
  onOpenSidePanel?: () => void;
}

export function Header({ onOpenSidePanel }: HeaderProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const { theme, cycleTheme } = useTheme();
  const reduxUsername = useSelector((state: RootState) => state.auth.username);

  // Check localStorage for remembered device user (client-only, SSR-safe).
  // Mirrors wallet-legacy's autopost2 restore in Main.js — the avatar should
  // be visible whenever the device remembers a username, even before full auth.
  const rememberedUsername = useSyncExternalStore(
    () => () => {},
    () => getRememberedDeviceUsername(),
    () => null
  );

  const username = reduxUsername ?? rememberedUsername;
  const isLoggedIn = !!username;
  const signupUrl = process.env.NEXT_PUBLIC_SIGNUP_URL ?? 'https://signup.steemit.com';

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const themeIcon = theme === 'dark' ? <Moon data-icon="inline-start" /> : theme === 'light' ? <Sun data-icon="inline-start" /> : <Monitor data-icon="inline-start" />;
  const themeLabel = theme === 'dark' ? 'Dark Mode' : theme === 'light' ? 'Light Mode' : 'Original Mode';

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'
      )}
    >
      <nav className="flex h-16 items-center px-4 md:px-6">
        {/* Logo - Left */}
        <div className="flex-shrink-0">
          <Link
            href="/"
            className="flex h-[37px] items-baseline text-accent-foreground transition-colors duration-200 hover:text-primary"
          >
            <SteemLogo />
          </Link>
        </div>

        {/* Right Side */}
        <div className="ml-auto flex h-16 items-center gap-2 md:gap-4">
          {/* Not Logged In: Login + Sign Up */}
          {!isLoggedIn && (
            <div className="hidden md:flex items-center gap-4">
              <Link
                href="/login"
                className="text-base font-medium transition-colors duration-200 hover:text-accent-foreground"
              >
                {t('login')}
              </Link>
              <Button asChild>
                <a
                  href={signupUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('signUp')}
                </a>
              </Button>
            </div>
          )}

          {/* Logged In: User Avatar Dropdown */}
          {isLoggedIn && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" className="rounded-full">
                  <Avatar size="lg">
                    <AvatarImage
                      src={`https://steemitimages.com/u/${username}/avatar`}
                      alt={username}
                    />
                    <AvatarFallback className="bg-primary text-primary-foreground font-bold text-sm">
                      {username?.charAt(0).toUpperCase()}
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
                  <Link href={`/@${username}/password`} className="cursor-pointer">
                    <Key data-icon="inline-start" />
                    <span>Change Password</span>
                  </Link>
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
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Hamburger Menu */}
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
    </header>
  );
}
