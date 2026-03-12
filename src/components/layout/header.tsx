'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import { RootState } from '@/lib/store';
import { SteemLogo } from './steem-logo';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { useTheme } from '@/lib/theme';
import { useTranslations } from 'next-intl';

export function Header() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { theme, changeTheme } = useTheme();
  const username = useSelector((state: RootState) => state.auth.username);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isLoggedIn = !!username;

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const userMenuItems = isLoggedIn
    ? [
        { label: 'Wallet', href: `/@${username}/transfers` },
        { label: 'Settings', href: `/@${username}/settings` },
        {
          label: 'Theme',
          action: () => {
            const themes: readonly ['original', 'light', 'dark'] = ['original', 'light', 'dark'] as const;
            const currentIndex = themes.indexOf(theme);
            const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themes.length : 0;
            changeTheme(themes[nextIndex]!);
          },
        },
        { label: 'Logout', action: handleLogout },
      ]
    : [];

  return (
    <header className="Header fixed top-0 left-0 w-full z-[100] shadow-sm bg-module border-b border-themed transition-colors duration-200">
      <nav className="flex items-center h-16 max-w-none px-4 md:px-6">
        {/* Logo - Left */}
        <div className="flex-shrink-0">
          <Link href="/" className="block h-[37px] flex items-baseline transition-colors duration-200">
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
                className="text-sm font-medium transition-colors duration-200 hover:text-steem-blue"
              >
                {t('login')}
              </Link>
              <Link
                href="/signup"
                className="e-btn e-btn-black px-4 py-2 text-sm font-bold"
              >
                {t('signUp')}
              </Link>
            </div>
          )}

          {/* Logged In: User Avatar + Menu */}
          {isLoggedIn && (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title={username}
              >
                <div className="w-9 h-9 md:w-10 md:h-10 rounded bg-gradient-to-br from-steem-blue to-teal flex items-center justify-center text-white font-bold text-sm">
                  {username?.charAt(0).toUpperCase()}
                </div>
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-background-dark border border-gray-200 dark:border-border-dark rounded-legacy shadow-lg z-20">
                    {userMenuItems.map((item, index) => (
                      <Link
                        key={index}
                        href={item.href || '#'}
                        onClick={(e) => {
                          if (item.action) {
                            e.preventDefault();
                            item.action();
                          }
                          setUserMenuOpen(false);
                        }}
                        className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-md last:rounded-b-md"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Mobile Language Toggle */}
          {!isLoggedIn && (
            <div className="md:hidden">
              <LanguageSwitcher />
            </div>
          )}

          {/* Hamburger Menu */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="w-4 h-4 ml-2 md:ml-4 relative"
            aria-label="Menu"
          >
            <span
              className={`block w-full h-0.5 bg-current transition-all duration-200 ${
                mobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''
              }`}
            />
            <span
              className={`block w-full h-0.5 bg-current mt-1.5 transition-all duration-200 ${
                mobileMenuOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`block w-full h-0.5 bg-current mt-1.5 transition-all duration-200 ${
                mobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''
              }`}
            />
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-themed bg-module">
          <div className="px-4 py-4 space-y-3">
            {!isLoggedIn ? (
              <>
                <Link
                  href="/login"
                  className="block py-2 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('login')}
                </Link>
                <Link
                  href="/signup"
                  className="block py-2 text-sm font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t('signUp')}
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={`/@${username}/transfers`}
                  className="block py-2 text-sm"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Wallet
                </Link>
                <Link
                  href={`/@${username}/settings`}
                  className="block py-2 text-sm"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Settings
                </Link>
                <button
                  onClick={() => {
                    const themes: readonly ['original', 'light', 'dark'] = ['original', 'light', 'dark'] as const;
                    const currentIndex = themes.indexOf(theme);
                    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % themes.length : 0;
                    changeTheme(themes[nextIndex]!);
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left py-2 text-sm"
                >
                  Theme ({theme})
                </button>
                <button
                  onClick={() => {
                    handleLogout();
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left py-2 text-sm"
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
