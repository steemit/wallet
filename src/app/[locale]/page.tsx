import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('navigation');
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold">Steem Wallet</h1>
      <p className="mt-4 text-lg text-gray-600">{t('home')}</p>
    </div>
  );
}
