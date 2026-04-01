'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { LoginForm } from '@/components/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';
import { getRememberedDeviceUsername } from '@/lib/auth/browser-storage';
import { transfersPathForUsername } from '@/lib/wallet/wallet-modal-search-params';

/**
 * Root path: redirect to /@rememberedUser/transfers when a username is stored locally;
 * otherwise show the login form.
 */
export function HomeRedirectOrLogin() {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'login'>('checking');

  useEffect(() => {
    const remembered = getRememberedDeviceUsername();
    if (remembered) {
      router.replace(transfersPathForUsername(remembered));
      return;
    }
    const id = requestAnimationFrame(() => setPhase('login'));
    return () => cancelAnimationFrame(id);
  }, [router]);

  if (phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <LoginForm />
    </div>
  );
}
