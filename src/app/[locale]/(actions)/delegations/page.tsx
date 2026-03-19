import { DelegationsPageClient } from '@/components/wallet/client-wrappers';

export default function DelegationsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 md:px-6">
      <DelegationsPageClient />
    </div>
  );
}
