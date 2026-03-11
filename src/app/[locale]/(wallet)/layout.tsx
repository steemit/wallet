import { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function WalletLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations('wallet');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white">
                Steem Wallet
              </Link>
              <nav className="hidden md:flex space-x-6">
                <Link
                  href="/wallet"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  {t('title')}
                </Link>
                <Link
                  href="/wallet/transfer"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  {t('transfer')}
                </Link>
                <Link
                  href="/wallet/power-down"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  {t('powerDown')}
                </Link>
                <Link
                  href="/wallet/witnesses"
                  className="text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                >
                  {t('witnesses')}
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <button
                type="button"
                className="text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
