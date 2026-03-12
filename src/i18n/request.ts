import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  // When localePrefix is 'never', detect locale from cookie or Accept-Language header
  let locale = await requestLocale;

  if (!locale) {
    // Try to get locale from cookie first
    const cookieStore = await cookies();
    const localeCookie = cookieStore.get('NEXT_LOCALE');
    if (localeCookie?.value && routing.locales.includes(localeCookie.value as any)) {
      locale = localeCookie.value;
    } else {
      // Fallback to Accept-Language header
      const headersList = await headers();
      const acceptLanguage = headersList.get('accept-language') || '';
      const preferredLocale = acceptLanguage
        .split(',')
        .map(lang => lang.split('-')[0])
        .find(lang => routing.locales.includes(lang as any));
      locale = preferredLocale || routing.defaultLocale;
    }
  }

  // Ensure that a valid locale is used
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
