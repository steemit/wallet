'use client';

import { useRouter } from '@/i18n/routing';
import { routing } from '@/i18n/routing';
import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';

const localeNames: Record<string, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
};

export function LanguageSwitcher({ onLocaleSelected }: { onLocaleSelected?: () => void }) {
  const router = useRouter();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const currentLocale = routing.locales.includes(locale as (typeof routing.locales)[number])
    ? (locale as (typeof routing.locales)[number])
    : routing.defaultLocale;

  const changeLocale = (newLocale: string) => {
    if (newLocale === currentLocale) {
      return;
    }

    // Set cookie for server-side detection
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;

    onLocaleSelected?.();

    // Refresh to apply new locale
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          disabled={isPending}
        >
          <span>{localeNames[currentLocale] || currentLocale}</span>
          <ChevronDown data-icon="inline-end" className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px]">
        <DropdownMenuRadioGroup value={currentLocale} onValueChange={changeLocale}>
          {routing.locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} disabled={isPending}>
              {localeNames[locale] || locale}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
