'use client';

import { usePathname, useRouter } from '@/i18n/routing';
import { routing } from '@/i18n/routing';
import { useState, useTransition } from 'react';

const localeNames: Record<string, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  const currentLocale = pathname.split('/')[1] || 'en';

  const changeLocale = (newLocale: string) => {
    // Set cookie for server-side detection
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;

    // Refresh to apply new locale
    startTransition(() => {
      router.refresh();
    });

    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
        disabled={isPending}
      >
        <span>{localeNames[currentLocale] || currentLocale}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg z-50 min-w-[150px]">
          {routing.locales.map((locale) => (
            <button
              key={locale}
              onClick={() => changeLocale(locale)}
              className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-md last:rounded-b-md ${
                locale === currentLocale ? 'font-bold text-steem-blue' : ''
              }`}
            >
              {localeNames[locale] || locale}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
