'use client';

import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '@/lib/store';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { StaticPageShell } from '@/components/layout/static-page-shell';
import { Skeleton } from '@/components/ui/skeleton';

/** Legacy `/change_password` — send signed-in users to their password page. */
export function ChangePasswordRedirect() {
  const t = useTranslations('wallet');
  const router = useRouter();
  const username = useSelector((state: RootState) => state.auth.username);

  useEffect(() => {
    if (username) {
      router.replace(`/@${username}/password`);
      return;
    }
    router.replace('/login');
  }, [username, router]);

  return (
    <StaticPageShell title={t('navChangeAccountPassword')}>
      <Skeleton className="h-24 w-full" />
    </StaticPageShell>
  );
}
