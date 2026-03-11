import { LoginForm } from '@/components/auth/login-form';
import { useTranslations } from 'next-intl';

export default function LoginPage() {
  const t = useTranslations('auth');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Steem Wallet
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t('login')}
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
