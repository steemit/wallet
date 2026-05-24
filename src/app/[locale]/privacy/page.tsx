import { PrivacyPolicyContent } from '@/components/content/privacy-policy';
import '@/components/content/privacy-policy.css';

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
      <PrivacyPolicyContent />
    </div>
  );
}
