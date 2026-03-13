'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import { RootState } from '@/lib/store';
import { SteemLogo } from './steem-logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { useTheme } from '@/lib/theme';
import { useTranslations } from 'next-intl';
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
  const username = useSelector((state: RootState) => state.auth.username);

  const isLoggedIn = !!username;

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const themeIcon = theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'light' ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />;
  const themeLabel = theme === 'dark' ? 'Dark Mode' : theme === 'light' ? 'Light Mode' : 'Original Mode';

  return (
    <header className="Header">
      <nav className="flex items-center h-16 max-w-none px-4 md:px-6">
        {/* Logo - Left */}
        <div className="flex-shrink-0">
          <Link href="/" className="flex items-baseline h-[37px] transition-colors duration-200">
            <SteemLogo />
          </Link>
        </div>

        {/* Right Side */}
        <div className="ml-auto flex items-center h-16 gap-2 md:gap-4">
          {/* Language Switcher */}
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>

          {/* Not Logged In: Login + Sign Up */}
          {!isLoggedIn && (
            <div className="hidden md:flex items-center gap-4">
              <Link
                href="/login"
                className="text-sm font-medium transition-colors duration-200 hover:text-primary"
              >
                {t('login')}
              </Link>
              <Button asChild size="sm">
                <Link href="/signup">
                  {t('signUp')}
                </Link>
              </Button>
            </div>
          )}

          {/* Logged In: User Avatar Dropdown */}
          {isLoggedIn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0">
                  <Avatar className="h-9 w-9">
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
                    <Wallet className="h-4 w-4" />
                    <span>Wallet</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={cycleTheme} className="cursor-pointer">
                  {themeIcon}
                  <span>{themeLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/@${username}/password`} className="cursor-pointer">
                    <Key className="h-4 w-4" />
                    <span>Change Password</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/@${username}/settings`} className="cursor-pointer">
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Mobile Language Toggle */}
          {!isLoggedIn && (
            <div className="md:hidden">
              <LanguageSwitcher />
            </div>
          )}

          {/* Hamburger Menu */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onOpenSidePanel}
            aria-label="Menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </nav>
    </header>
  );
}
